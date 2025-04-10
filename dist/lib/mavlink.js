"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSigned = exports.send = exports.createMavLinkStream = exports.MavLinkPacketParser = exports.MavLinkTLogPacketSplitter = exports.MavLinkPacketSplitter = exports.MavLinkPacket = exports.MavLinkPacketSignature = exports.MavLinkProtocolV2 = exports.MavLinkProtocolV1 = exports.MavLinkProtocol = exports.MavLinkPacketHeader = void 0;
const stream_1 = require("stream");
const crypto_1 = require("crypto");
const mavlink_mappings_1 = require("mavlink-mappings");
const mavlink_mappings_2 = require("mavlink-mappings");
const utils_1 = require("./utils");
const logger_1 = require("./logger");
const serialization_1 = require("./serialization");
/**
 * Header definition of the MavLink packet
 */
class MavLinkPacketHeader {
    timestamp = null;
    magic = 0;
    payloadLength = 0;
    incompatibilityFlags = 0;
    compatibilityFlags = 0;
    seq = 0;
    sysid = 0;
    compid = 0;
    msgid = 0;
}
exports.MavLinkPacketHeader = MavLinkPacketHeader;
/**
 * Base class for protocols
 *
 * Implements common functionality like getting the CRC and deserializing
 * data classes from the given payload buffer
 */
class MavLinkProtocol {
    log = logger_1.Logger.getLogger(this);
    static NAME = 'unknown';
    static START_BYTE = 0;
    static PAYLOAD_OFFSET = 0;
    static CHECKSUM_LENGTH = 2;
    static SYS_ID = 254;
    static COMP_ID = 1;
    get name() {
        return this.constructor.NAME;
    }
    /**
     * Deserialize payload into actual data class
     */
    data(payload, clazz) {
        this.log.trace('Deserializing', clazz.MSG_NAME, 'with payload of size', payload.length);
        const instance = new clazz();
        let payloadLength = payload.length;
        for (const field of clazz.FIELDS) {
            const fieldLength = field.length === 0 ? field.size : field.length * field.size;
            const deserialize = serialization_1.DESERIALIZERS[field.type];
            if (!deserialize) {
                throw new Error(`Unknown field type ${field.type}`);
            }
            // Pad the payload if it is trimmed
            // https://mavlink.io/en/guide/serialization.html
            // MAVLink 2 implementations must truncate any empty (zero-filled)
            // bytes at the end of the serialized payload before it is sent.
            if (fieldLength > payloadLength) {
                const diff = fieldLength - payloadLength;
                const newPayloadLength = payload.length + diff;
                const newBuffer = Buffer.alloc(newPayloadLength);
                payload.copy(newBuffer, 0, 0, payload.length);
                payload = newBuffer;
            }
            // @ts-ignore
            instance[field.name] = deserialize(payload, field.offset, field.length);
            payloadLength -= fieldLength;
        }
        return instance;
    }
}
exports.MavLinkProtocol = MavLinkProtocol;
/**
 * MavLink Protocol V1
 */
class MavLinkProtocolV1 extends MavLinkProtocol {
    sysid;
    compid;
    static NAME = 'MAV_V1';
    static START_BYTE = 0xFE;
    static PAYLOAD_OFFSET = 6;
    constructor(sysid = MavLinkProtocol.SYS_ID, compid = MavLinkProtocol.COMP_ID) {
        super();
        this.sysid = sysid;
        this.compid = compid;
    }
    serialize(message, seq) {
        this.log.trace('Serializing message (seq:', seq, ')');
        const definition = message.constructor;
        const buffer = Buffer.from(new Uint8Array(MavLinkProtocolV1.PAYLOAD_OFFSET + definition.PAYLOAD_LENGTH + MavLinkProtocol.CHECKSUM_LENGTH));
        // serialize header
        buffer.writeUInt8(MavLinkProtocolV1.START_BYTE, 0);
        buffer.writeUInt8(definition.PAYLOAD_LENGTH, 1);
        buffer.writeUInt8(seq, 2);
        buffer.writeUInt8(this.sysid, 3);
        buffer.writeUInt8(this.compid, 4);
        buffer.writeUInt8(definition.MSG_ID, 5);
        // serialize fields
        definition.FIELDS.forEach(field => {
            const serialize = serialization_1.SERIALIZERS[field.type];
            if (!serialize)
                throw new Error(`Unknown field type ${field.type}: serializer not found`);
            // @ts-ignore
            serialize(message[field.name], buffer, field.offset + MavLinkProtocolV1.PAYLOAD_OFFSET, field.length);
        });
        // serialize checksum
        const crc = (0, mavlink_mappings_1.x25crc)(buffer, 1, 2, definition.MAGIC_NUMBER);
        buffer.writeUInt16LE(crc, buffer.length - 2);
        return buffer;
    }
    header(buffer, timestamp) {
        this.log.trace('Reading header from buffer (len:', buffer.length, ')');
        const startByte = buffer.readUInt8(0);
        if (startByte !== MavLinkProtocolV1.START_BYTE) {
            throw new Error(`Invalid start byte (expected: ${MavLinkProtocolV1.START_BYTE}, got ${startByte})`);
        }
        const result = new MavLinkPacketHeader();
        result.timestamp = timestamp || null;
        result.payloadLength = buffer.readUInt8(1);
        result.seq = buffer.readUInt8(2);
        result.sysid = buffer.readUInt8(3);
        result.compid = buffer.readUInt8(4);
        result.msgid = buffer.readUInt8(5);
        return result;
    }
    /**
     * Deserialize packet checksum
     */
    crc(buffer) {
        this.log.trace('Reading crc from buffer (len:', buffer.length, ')');
        const plen = buffer.readUInt8(1);
        return buffer.readUInt16LE(MavLinkProtocolV1.PAYLOAD_OFFSET + plen);
    }
    payload(buffer) {
        this.log.trace('Reading payload from buffer (len:', buffer.length, ')');
        const plen = buffer.readUInt8(1);
        const payload = buffer.slice(MavLinkProtocolV1.PAYLOAD_OFFSET, MavLinkProtocolV1.PAYLOAD_OFFSET + plen);
        const padding = Buffer.from(new Uint8Array(255 - payload.length));
        return Buffer.concat([payload, padding]);
    }
}
exports.MavLinkProtocolV1 = MavLinkProtocolV1;
/**
 * MavLink Protocol V2
 */
class MavLinkProtocolV2 extends MavLinkProtocol {
    sysid;
    compid;
    incompatibilityFlags;
    compatibilityFlags;
    static NAME = 'MAV_V2';
    static START_BYTE = 0xFD;
    static PAYLOAD_OFFSET = 10;
    static INCOMPATIBILITY_FLAGS = 0;
    static COMPATIBILITY_FLAGS = 0;
    static IFLAG_SIGNED = 0x01;
    static SIGNATURE_START_TIME = Date.UTC(2015, 0, 1);
    constructor(sysid = MavLinkProtocol.SYS_ID, compid = MavLinkProtocol.COMP_ID, incompatibilityFlags = MavLinkProtocolV2.INCOMPATIBILITY_FLAGS, compatibilityFlags = MavLinkProtocolV2.COMPATIBILITY_FLAGS) {
        super();
        this.sysid = sysid;
        this.compid = compid;
        this.incompatibilityFlags = incompatibilityFlags;
        this.compatibilityFlags = compatibilityFlags;
    }
    serialize(message, seq) {
        this.log.trace('Serializing message (seq:', seq, ')');
        const definition = message.constructor;
        const buffer = Buffer.from(new Uint8Array(MavLinkProtocolV2.PAYLOAD_OFFSET + definition.PAYLOAD_LENGTH + MavLinkProtocol.CHECKSUM_LENGTH));
        buffer.writeUInt8(MavLinkProtocolV2.START_BYTE, 0);
        buffer.writeUInt8(this.incompatibilityFlags, 2);
        buffer.writeUInt8(this.compatibilityFlags, 3);
        buffer.writeUInt8(seq, 4);
        buffer.writeUInt8(this.sysid, 5);
        buffer.writeUInt8(this.compid, 6);
        buffer.writeUIntLE(definition.MSG_ID, 7, 3);
        definition.FIELDS.forEach(field => {
            const serialize = serialization_1.SERIALIZERS[field.type];
            if (!serialize)
                throw new Error(`Unknown field type ${field.type}: serializer not found`);
            // @ts-ignore
            serialize(message[field.name], buffer, field.offset + MavLinkProtocolV2.PAYLOAD_OFFSET, field.length);
        });
        // calculate actual truncated payload length
        const payloadLength = this.calculateTruncatedPayloadLength(buffer);
        buffer.writeUInt8(payloadLength, 1);
        // slice out the message buffer
        const result = buffer.slice(0, MavLinkProtocolV2.PAYLOAD_OFFSET + payloadLength + MavLinkProtocol.CHECKSUM_LENGTH);
        const crc = (0, mavlink_mappings_1.x25crc)(result, 1, 2, definition.MAGIC_NUMBER);
        result.writeUInt16LE(crc, result.length - MavLinkProtocol.CHECKSUM_LENGTH);
        return result;
    }
    /**
     * Create a signed package buffer
     *
     * @param buffer buffer with the original, unsigned package
     * @param linkId id of the link
     * @param key key to sign the package with
     * @param timestamp optional timestamp for packet signing (default: Date.now())
     * @returns signed package
     */
    sign(buffer, linkId, key, timestamp = Date.now()) {
        this.log.trace('Signing message');
        const result = Buffer.concat([
            buffer,
            Buffer.from(new Uint8Array(MavLinkPacketSignature.SIGNATURE_LENGTH))
        ]);
        const signer = new MavLinkPacketSignature(result);
        signer.linkId = linkId;
        signer.timestamp = (timestamp - MavLinkProtocolV2.SIGNATURE_START_TIME) * 100;
        signer.signature = signer.calculate(key);
        return result;
    }
    calculateTruncatedPayloadLength(buffer) {
        let result = buffer.length;
        for (let i = buffer.length - MavLinkProtocol.CHECKSUM_LENGTH - 1; i >= MavLinkProtocolV2.PAYLOAD_OFFSET; i--) {
            result = i;
            if (buffer[i] !== 0) {
                result++;
                break;
            }
        }
        return result - MavLinkProtocolV2.PAYLOAD_OFFSET;
    }
    header(buffer, timestamp) {
        this.log.trace('Reading header from buffer (len:', buffer.length, ')');
        const startByte = buffer.readUInt8(0);
        if (startByte !== MavLinkProtocolV2.START_BYTE) {
            throw new Error(`Invalid start byte (expected: ${MavLinkProtocolV2.START_BYTE}, got ${startByte})`);
        }
        const result = new MavLinkPacketHeader();
        result.timestamp = timestamp || null;
        result.magic = startByte;
        result.payloadLength = buffer.readUInt8(1);
        result.incompatibilityFlags = buffer.readUInt8(2);
        result.compatibilityFlags = buffer.readUInt8(3);
        result.seq = buffer.readUInt8(4);
        result.sysid = buffer.readUInt8(5);
        result.compid = buffer.readUInt8(6);
        result.msgid = buffer.readUIntLE(7, 3);
        return result;
    }
    /**
     * Deserialize packet checksum
     */
    crc(buffer) {
        this.log.trace('Reading crc from buffer (len:', buffer.length, ')');
        const plen = buffer.readUInt8(1);
        return buffer.readUInt16LE(MavLinkProtocolV2.PAYLOAD_OFFSET + plen);
    }
    payload(buffer) {
        this.log.trace('Reading payload from buffer (len:', buffer.length, ')');
        const plen = buffer.readUInt8(1);
        const payload = buffer.slice(MavLinkProtocolV2.PAYLOAD_OFFSET, MavLinkProtocolV2.PAYLOAD_OFFSET + plen);
        const padding = Buffer.from(new Uint8Array(255 - payload.length));
        return Buffer.concat([payload, padding]);
    }
    signature(buffer, header) {
        this.log.trace('Reading signature from buffer (len:', buffer.length, ')');
        if (header.incompatibilityFlags & MavLinkProtocolV2.IFLAG_SIGNED) {
            return new MavLinkPacketSignature(buffer);
        }
        else {
            return null;
        }
    }
}
exports.MavLinkProtocolV2 = MavLinkProtocolV2;
/**
 * Registry of known protocols by STX
 */
const KNOWN_PROTOCOLS_BY_STX = {
    [MavLinkProtocolV1.START_BYTE]: MavLinkProtocolV1,
    [MavLinkProtocolV2.START_BYTE]: MavLinkProtocolV2,
};
/**
 * MavLink packet signature definition
 */
class MavLinkPacketSignature {
    buffer;
    static SIGNATURE_LENGTH = 13;
    /**
     * Calculate key based on secret passphrase
     *
     * @param passphrase secret to generate the key
     * @returns key as a buffer
     */
    static key(passphrase) {
        return (0, crypto_1.createHash)('sha256')
            .update(passphrase)
            .digest();
    }
    constructor(buffer) {
        this.buffer = buffer;
    }
    get offset() {
        return this.buffer.length - MavLinkPacketSignature.SIGNATURE_LENGTH;
    }
    /**
     * Get the linkId from signature
     */
    get linkId() {
        return this.buffer.readUInt8(this.offset);
    }
    /**
     * Set the linkId in signature
     */
    set linkId(value) {
        this.buffer.writeUInt8(value, this.offset);
    }
    /**
     * Get the timestamp from signature
     */
    get timestamp() {
        return this.buffer.readUIntLE(this.offset + 1, 6);
    }
    /**
     * Set the linkId in signature
     */
    set timestamp(value) {
        this.buffer.writeUIntLE(value, this.offset + 1, 6);
    }
    /**
     * Get the signature from signature
     */
    get signature() {
        return this.buffer.slice(this.offset + 7, this.offset + 7 + 6).toString('hex');
    }
    /**
     * Set the signature in signature
     */
    set signature(value) {
        this.buffer.write(value, this.offset + 7, 'hex');
    }
    /**
     * Calculates signature of the packet buffer using the provided secret.
     * The secret is converted to a hash using the sha256 algorithm which matches
     * the way Mission Planner creates keys.
     *
     * @param key the secret key (Buffer)
     * @returns calculated signature value
     */
    calculate(key) {
        const hash = (0, crypto_1.createHash)('sha256')
            .update(key)
            .update(this.buffer.slice(0, this.buffer.length - 6))
            .digest('hex')
            .substr(0, 12);
        return hash;
    }
    /**
     * Checks the signature of the packet buffer against a given secret
     * The secret is converted to a hash using the sha256 algorithm which matches
     * the way Mission Planner creates keys.
     *
     * @param key key
     * @returns true if the signature matches, false otherwise
     */
    matches(key) {
        return this.calculate(key) === this.signature;
    }
    toString() {
        return `linkid: ${this.linkId}, timestamp ${this.timestamp}, signature ${this.signature}`;
    }
}
exports.MavLinkPacketSignature = MavLinkPacketSignature;
/**
 * MavLink packet definition
 */
class MavLinkPacket {
    buffer;
    header;
    payload;
    crc;
    protocol;
    signature;
    constructor(buffer, header = new MavLinkPacketHeader(), payload = Buffer.from(new Uint8Array(255)), crc = 0, protocol = new MavLinkProtocolV1(), signature = null) {
        this.buffer = buffer;
        this.header = header;
        this.payload = payload;
        this.crc = crc;
        this.protocol = protocol;
        this.signature = signature;
    }
    /**
     * Debug information about the packet
     *
     * @returns string representing debug information about a packet
     */
    debug() {
        return 'Packet ('
            // @ts-ignore
            + `proto: ${this.protocol.name}, `
            + `sysid: ${this.header.sysid}, `
            + `compid: ${this.header.compid}, `
            + `msgid: ${this.header.msgid}, `
            + `seq: ${this.header.seq}, `
            + `plen: ${this.header.payloadLength}, `
            + `crc: ${(0, utils_1.hex)(this.crc, 4)}`
            + this.signatureToString(this.signature)
            + ')';
    }
    signatureToString(signature) {
        return signature ? `, ${signature.toString()}` : '';
    }
}
exports.MavLinkPacket = MavLinkPacket;
/**
 * This enum describes the different ways validation of a buffer can end
 */
var PacketValidationResult;
(function (PacketValidationResult) {
    PacketValidationResult[PacketValidationResult["VALID"] = 0] = "VALID";
    PacketValidationResult[PacketValidationResult["INVALID"] = 1] = "INVALID";
    PacketValidationResult[PacketValidationResult["UNKNOWN"] = 2] = "UNKNOWN";
})(PacketValidationResult || (PacketValidationResult = {}));
/**
 * A transform stream that splits the incoming data stream into chunks containing full MavLink messages
 */
class MavLinkPacketSplitter extends stream_1.Transform {
    log = logger_1.Logger.getLogger(this);
    buffer = Buffer.from([]);
    onCrcError = null;
    magicNumbers;
    timestamp = null;
    _validPackagesCount = 0;
    _unknownPackagesCount = 0;
    _invalidPackagesCount = 0;
    /**
     * @param opts options to pass on to the Transform constructor
     * @param verbose print diagnostic information
     * @param onCrcError callback executed if there is a CRC error (mostly for debugging)
     */
    constructor(opts = {}, { onCrcError = () => { }, magicNumbers = mavlink_mappings_2.MSG_ID_MAGIC_NUMBER } = {}) {
        super({ ...opts, objectMode: true });
        this.onCrcError = onCrcError;
        this.magicNumbers = magicNumbers;
    }
    _transform(chunk, encoding, callback) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.byteLength > 0) {
            const offset = this.findStartOfPacket(this.buffer);
            if (offset === null) {
                // start of the package was not found - need more data
                break;
            }
            // if the current offset is exactly the size of the timestamp field from tlog then read it.
            if (offset >= 8) {
                this.timestamp = this.buffer.readBigUInt64BE(offset - 8) / 1000n;
            }
            else {
                this.timestamp = null;
            }
            // fast-forward the buffer to the first start byte
            if (offset > 0) {
                this.buffer = this.buffer.slice(offset);
            }
            this.log.debug('Found potential packet start at', offset);
            // get protocol this buffer is encoded with
            const Protocol = this.getPacketProtocol(this.buffer);
            this.log.debug('Packet protocol is', Protocol.NAME);
            // check if the buffer contains at least the minimum size of data
            if (this.buffer.length < Protocol.PAYLOAD_OFFSET + MavLinkProtocol.CHECKSUM_LENGTH) {
                // current buffer shorter than the shortest message - skipping
                this.log.debug('Current buffer shorter than the shortest message - skipping');
                break;
            }
            // check if the current buffer contains the entire message
            const expectedBufferLength = this.readPacketLength(this.buffer, Protocol);
            this.log.debug('Expected buffer length:', expectedBufferLength, `(${(0, utils_1.hex)(expectedBufferLength)})`);
            if (this.buffer.length < expectedBufferLength) {
                // current buffer is not fully retrieved yet - skipping
                this.log.debug('Current buffer is not fully retrieved yet - skipping');
                break;
            }
            else {
                this.log.debug('Current buffer length:', this.buffer.length, `(${(0, utils_1.hex)(this.buffer.length, 4)})`);
            }
            // retrieve the buffer based on payload size
            const buffer = this.buffer.slice(0, expectedBufferLength);
            this.log.debug('Recognized buffer length:', buffer.length, `(${(0, utils_1.hex)(buffer.length, 2)})`);
            switch (this.validatePacket(buffer, Protocol)) {
                case PacketValidationResult.VALID:
                    this.log.debug('Found a valid packet');
                    this._validPackagesCount++;
                    this.push({ buffer, timestamp: this.timestamp });
                    // truncate the buffer to remove the current message
                    this.buffer = this.buffer.slice(expectedBufferLength);
                    break;
                case PacketValidationResult.INVALID:
                    this.log.debug('Found an invalid packet - skipping');
                    this._invalidPackagesCount++;
                    // truncate the buffer to remove the wrongly identified STX
                    this.buffer = this.buffer.slice(1);
                    break;
                case PacketValidationResult.UNKNOWN:
                    this.log.debug('Found an unknown packet - skipping');
                    this._unknownPackagesCount++;
                    // truncate the buffer to remove the current message
                    this.buffer = this.buffer.slice(expectedBufferLength);
                    break;
            }
        }
        callback(null);
    }
    findStartOfPacket(buffer, offset = 0) {
        const stxv1 = buffer.indexOf(MavLinkProtocolV1.START_BYTE, offset);
        const stxv2 = buffer.indexOf(MavLinkProtocolV2.START_BYTE, offset);
        if (stxv1 >= 0 && stxv2 >= 0) {
            // in the current buffer both STX v1 and v2 are found - get the first one
            if (stxv1 < stxv2) {
                return stxv1;
            }
            else {
                return stxv2;
            }
        }
        else if (stxv1 >= 0) {
            // in the current buffer STX v1 is found
            return stxv1;
        }
        else if (stxv2 >= 0) {
            // in the current buffer STX v2 is found
            return stxv2;
        }
        else {
            // no STX found
            return null;
        }
    }
    getPacketProtocol(buffer) {
        return KNOWN_PROTOCOLS_BY_STX[buffer.readUInt8(0)] || null;
    }
    readPacketLength(buffer, Protocol) {
        // check if the current buffer contains the entire message
        const payloadLength = buffer.readUInt8(1);
        return Protocol.PAYLOAD_OFFSET
            + payloadLength
            + MavLinkProtocol.CHECKSUM_LENGTH
            + (this.isV2Signed(buffer) ? MavLinkPacketSignature.SIGNATURE_LENGTH : 0);
    }
    validatePacket(buffer, Protocol) {
        const protocol = new Protocol();
        const header = protocol.header(buffer);
        const magic = this.magicNumbers[header.msgid];
        if (magic !== null && magic !== undefined) {
            const crc = protocol.crc(buffer);
            const trim = this.isV2Signed(buffer)
                ? MavLinkPacketSignature.SIGNATURE_LENGTH + MavLinkProtocol.CHECKSUM_LENGTH
                : MavLinkProtocol.CHECKSUM_LENGTH;
            const crc2 = (0, mavlink_mappings_1.x25crc)(buffer, 1, trim, magic);
            if (crc === crc2) {
                // this is a proper message that is known and has been validated for corrupted data
                return PacketValidationResult.VALID;
            }
            else {
                // CRC mismatch
                const message = [
                    `CRC error; expected: ${crc2} (${(0, utils_1.hex)(crc2, 4)}), got ${crc} (${(0, utils_1.hex)(crc, 4)});`,
                    `msgid: ${header.msgid} (${(0, utils_1.hex)(header.msgid)}),`,
                    `seq: ${header.seq} (${(0, utils_1.hex)(header.seq)}),`,
                    `plen: ${header.payloadLength} (${(0, utils_1.hex)(header.payloadLength)}),`,
                    `magic: ${magic} (${(0, utils_1.hex)(magic)})`,
                ];
                this.log.warn(message.join(' '));
                if (this.onCrcError)
                    this.onCrcError(buffer);
                return PacketValidationResult.INVALID;
            }
        }
        else {
            // unknown message (as in not generated from the XML sources)
            this.log.debug(`Unknown message with id ${header.msgid} (magic number not found) - skipping`);
            return PacketValidationResult.UNKNOWN;
        }
    }
    /**
     * Checks if the buffer contains the entire message with signature
     *
     * @param buffer buffer with the message
     */
    isV2Signed(buffer) {
        const protocol = buffer.readUInt8(0);
        if (protocol === MavLinkProtocolV2.START_BYTE) {
            const flags = buffer.readUInt8(2);
            return !!(flags & MavLinkProtocolV2.IFLAG_SIGNED);
        }
    }
    /**
     * Number of invalid packages
     */
    get validPackages() {
        return this._validPackagesCount;
    }
    /**
     * Reset the number of valid packages
     */
    resetValidPackagesCount() {
        this._validPackagesCount = 0;
    }
    /**
     * Number of invalid packages
     */
    get invalidPackages() {
        return this._invalidPackagesCount;
    }
    /**
     * Reset the number of invalid packages
     */
    resetInvalidPackagesCount() {
        this._invalidPackagesCount = 0;
    }
    /**
     * Number of invalid packages
     */
    get unknownPackagesCount() {
        return this._unknownPackagesCount;
    }
    /**
     * Reset the number of invalid packages
     */
    resetUnknownPackagesCount() {
        this._unknownPackagesCount = 0;
    }
}
exports.MavLinkPacketSplitter = MavLinkPacketSplitter;
class MavLinkTLogPacketSplitter extends MavLinkPacketSplitter {
    _transform(chunk, encoding, callback) {
        return super._transform(chunk, encoding, callback);
    }
    findStartOfPacket(buffer, offset = 0) {
        // Finding the start of packet in TLog requires locating the start byte
        // at an offset greater than
        let offset1 = offset;
        while (true) {
            const start = super.findStartOfPacket(buffer, offset1);
            if (start === null)
                return null;
            if (start < 8)
                offset1 = start + 1;
            else if (offset1 >= buffer.length - 1)
                return null;
            else
                return start;
        }
    }
}
exports.MavLinkTLogPacketSplitter = MavLinkTLogPacketSplitter;
/**
 * A transform stream that takes a buffer with data and converts it to MavLinkPacket object
 */
class MavLinkPacketParser extends stream_1.Transform {
    log = logger_1.Logger.getLogger(this);
    constructor(opts = {}) {
        super({ ...opts, objectMode: true });
    }
    getProtocol(buffer) {
        const startByte = buffer.readUInt8(0);
        switch (startByte) {
            case MavLinkProtocolV1.START_BYTE:
                return new MavLinkProtocolV1();
            case MavLinkProtocolV2.START_BYTE:
                return new MavLinkProtocolV2();
            default:
                throw new Error(`Unknown protocol '${(0, utils_1.hex)(startByte)}'`);
        }
    }
    _transform({ buffer = Buffer.from([]), timestamp = null, ...rest } = {}, encoding, callback) {
        const protocol = this.getProtocol(buffer);
        const header = protocol.header(buffer, timestamp || undefined);
        const payload = protocol.payload(buffer);
        const crc = protocol.crc(buffer);
        const signature = protocol instanceof MavLinkProtocolV2
            ? protocol.signature(buffer, header)
            : null;
        const packet = new MavLinkPacket(buffer, header, payload, crc, protocol, signature);
        callback(null, packet);
    }
}
exports.MavLinkPacketParser = MavLinkPacketParser;
/**
 * Creates a MavLink packet stream reader that is reading packets from the given input
 *
 * @param input input stream to read from
 */
function createMavLinkStream(input, { onCrcError, magicNumbers } = {}) {
    return input
        .pipe(new MavLinkPacketSplitter({}, { onCrcError, magicNumbers }))
        .pipe(new MavLinkPacketParser());
}
exports.createMavLinkStream = createMavLinkStream;
let seq = 0;
/**
 * Send a packet to the stream
 *
 * @param stream Stream to send the data to
 * @param msg message to serialize and send
 * @param protocol protocol to use (default: MavLinkProtocolV1)
 * @returns number of bytes sent
 */
async function send(stream, msg, protocol = new MavLinkProtocolV1()) {
    return new Promise((resolve, reject) => {
        const buffer = protocol.serialize(msg, seq++);
        seq &= 255;
        stream.write(buffer, err => {
            if (err)
                reject(err);
            else
                resolve(buffer.length);
        });
    });
}
exports.send = send;
/**
 * Send a signed packet to the stream. Signed packets are always V2 protocol
 *
 * @param stream Stream to send the data to
 * @param msg message to serialize and send
 * @param key key to sign the message with
 * @param linkId link id for the signature
 * @param sysid system id
 * @param compid component id
 * @param timestamp optional timestamp for packet signing (default: Date.now())
 * @returns number of bytes sent
 */
async function sendSigned(stream, msg, key, linkId = 1, sysid = MavLinkProtocol.SYS_ID, compid = MavLinkProtocol.COMP_ID, timestamp = Date.now()) {
    return new Promise((resolve, reject) => {
        const protocol = new MavLinkProtocolV2(sysid, compid, MavLinkProtocolV2.IFLAG_SIGNED);
        const b1 = protocol.serialize(msg, seq++);
        seq &= 255;
        const b2 = protocol.sign(b1, linkId, key, timestamp);
        stream.write(b2, err => {
            if (err)
                reject(err);
            else
                resolve(b2.length);
        });
    });
}
exports.sendSigned = sendSigned;
