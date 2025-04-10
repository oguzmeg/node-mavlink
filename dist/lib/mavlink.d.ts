/// <reference types="node" />
/// <reference types="node" />
import { Transform, TransformCallback, Readable, Writable } from 'stream';
import { uint8_t, uint16_t } from 'mavlink-mappings';
import { MavLinkData, MavLinkDataConstructor } from 'mavlink-mappings';
import { Logger } from './logger';
/**
 * Header definition of the MavLink packet
 */
export declare class MavLinkPacketHeader {
    timestamp: bigint | null;
    magic: number;
    payloadLength: uint8_t;
    incompatibilityFlags: uint8_t;
    compatibilityFlags: uint8_t;
    seq: uint8_t;
    sysid: uint8_t;
    compid: uint8_t;
    msgid: uint8_t;
}
/**
 * Base class for protocols
 *
 * Implements common functionality like getting the CRC and deserializing
 * data classes from the given payload buffer
 */
export declare abstract class MavLinkProtocol {
    protected readonly log: Logger;
    static NAME: string;
    static START_BYTE: number;
    static PAYLOAD_OFFSET: number;
    static CHECKSUM_LENGTH: number;
    static SYS_ID: uint8_t;
    static COMP_ID: uint8_t;
    get name(): string;
    /**
     * Serialize a message to a buffer
     */
    abstract serialize(message: MavLinkData, seq: uint8_t): Buffer;
    /**
     * Deserialize packet header
     */
    abstract header(buffer: Buffer, timestamp?: bigint): MavLinkPacketHeader;
    /**
     * Deserialize packet checksum
     */
    abstract crc(buffer: Buffer): uint16_t;
    /**
     * Extract payload buffer
     *
     * The returned payload buffer needs to be long enough to read all
     * the fields, including extensions that are sometimes not being sent
     * from the transmitting system.
     */
    abstract payload(buffer: Buffer): Buffer;
    /**
     * Deserialize payload into actual data class
     */
    data<T extends MavLinkData>(payload: Buffer, clazz: MavLinkDataConstructor<T>): T;
}
/**
 * MavLink Protocol V1
 */
export declare class MavLinkProtocolV1 extends MavLinkProtocol {
    sysid: uint8_t;
    compid: uint8_t;
    static NAME: string;
    static START_BYTE: number;
    static PAYLOAD_OFFSET: number;
    constructor(sysid?: uint8_t, compid?: uint8_t);
    serialize(message: MavLinkData, seq: number): Buffer;
    header(buffer: Buffer, timestamp?: bigint): MavLinkPacketHeader;
    /**
     * Deserialize packet checksum
     */
    crc(buffer: Buffer): uint16_t;
    payload(buffer: Buffer): Buffer;
}
/**
 * MavLink Protocol V2
 */
export declare class MavLinkProtocolV2 extends MavLinkProtocol {
    sysid: uint8_t;
    compid: uint8_t;
    incompatibilityFlags: uint8_t;
    compatibilityFlags: uint8_t;
    static NAME: string;
    static START_BYTE: number;
    static PAYLOAD_OFFSET: number;
    static INCOMPATIBILITY_FLAGS: uint8_t;
    static COMPATIBILITY_FLAGS: uint8_t;
    static readonly IFLAG_SIGNED = 1;
    static readonly SIGNATURE_START_TIME: number;
    constructor(sysid?: uint8_t, compid?: uint8_t, incompatibilityFlags?: uint8_t, compatibilityFlags?: uint8_t);
    serialize(message: MavLinkData, seq: number): Buffer;
    /**
     * Create a signed package buffer
     *
     * @param buffer buffer with the original, unsigned package
     * @param linkId id of the link
     * @param key key to sign the package with
     * @param timestamp optional timestamp for packet signing (default: Date.now())
     * @returns signed package
     */
    sign(buffer: Buffer, linkId: number, key: Buffer, timestamp?: number): Buffer;
    private calculateTruncatedPayloadLength;
    header(buffer: Buffer, timestamp?: bigint): MavLinkPacketHeader;
    /**
     * Deserialize packet checksum
     */
    crc(buffer: Buffer): uint16_t;
    payload(buffer: Buffer): Buffer;
    signature(buffer: Buffer, header: MavLinkPacketHeader): MavLinkPacketSignature | null;
}
/**
 * MavLink packet signature definition
 */
export declare class MavLinkPacketSignature {
    private readonly buffer;
    static SIGNATURE_LENGTH: number;
    /**
     * Calculate key based on secret passphrase
     *
     * @param passphrase secret to generate the key
     * @returns key as a buffer
     */
    static key(passphrase: string): Buffer;
    constructor(buffer: Buffer);
    private get offset();
    /**
     * Get the linkId from signature
     */
    get linkId(): uint8_t;
    /**
     * Set the linkId in signature
     */
    set linkId(value: uint8_t);
    /**
     * Get the timestamp from signature
     */
    get timestamp(): number;
    /**
     * Set the linkId in signature
     */
    set timestamp(value: number);
    /**
     * Get the signature from signature
     */
    get signature(): string;
    /**
     * Set the signature in signature
     */
    set signature(value: string);
    /**
     * Calculates signature of the packet buffer using the provided secret.
     * The secret is converted to a hash using the sha256 algorithm which matches
     * the way Mission Planner creates keys.
     *
     * @param key the secret key (Buffer)
     * @returns calculated signature value
     */
    calculate(key: Buffer): string;
    /**
     * Checks the signature of the packet buffer against a given secret
     * The secret is converted to a hash using the sha256 algorithm which matches
     * the way Mission Planner creates keys.
     *
     * @param key key
     * @returns true if the signature matches, false otherwise
     */
    matches(key: Buffer): boolean;
    toString(): string;
}
/**
 * MavLink packet definition
 */
export declare class MavLinkPacket {
    readonly buffer: Buffer;
    readonly header: MavLinkPacketHeader;
    readonly payload: Buffer;
    readonly crc: uint16_t;
    readonly protocol: MavLinkProtocol;
    readonly signature: MavLinkPacketSignature | null;
    constructor(buffer: Buffer, header?: MavLinkPacketHeader, payload?: Buffer, crc?: uint16_t, protocol?: MavLinkProtocol, signature?: MavLinkPacketSignature | null);
    /**
     * Debug information about the packet
     *
     * @returns string representing debug information about a packet
     */
    debug(): string;
    private signatureToString;
}
declare type BufferCallback = (buffer: Buffer) => void;
/**
 * A transform stream that splits the incoming data stream into chunks containing full MavLink messages
 */
export declare class MavLinkPacketSplitter extends Transform {
    protected readonly log: Logger;
    private buffer;
    private onCrcError;
    private readonly magicNumbers;
    private timestamp;
    private _validPackagesCount;
    private _unknownPackagesCount;
    private _invalidPackagesCount;
    /**
     * @param opts options to pass on to the Transform constructor
     * @param verbose print diagnostic information
     * @param onCrcError callback executed if there is a CRC error (mostly for debugging)
     */
    constructor(opts?: {}, { onCrcError, magicNumbers }?: {
        onCrcError?: BufferCallback;
        magicNumbers?: Record<string, number>;
    });
    _transform(chunk: Buffer, encoding: string, callback: TransformCallback): void;
    protected findStartOfPacket(buffer: Buffer, offset?: number): number | null;
    private getPacketProtocol;
    private readPacketLength;
    private validatePacket;
    /**
     * Checks if the buffer contains the entire message with signature
     *
     * @param buffer buffer with the message
     */
    private isV2Signed;
    /**
     * Number of invalid packages
     */
    get validPackages(): number;
    /**
     * Reset the number of valid packages
     */
    resetValidPackagesCount(): void;
    /**
     * Number of invalid packages
     */
    get invalidPackages(): number;
    /**
     * Reset the number of invalid packages
     */
    resetInvalidPackagesCount(): void;
    /**
     * Number of invalid packages
     */
    get unknownPackagesCount(): number;
    /**
     * Reset the number of invalid packages
     */
    resetUnknownPackagesCount(): void;
}
export declare class MavLinkTLogPacketSplitter extends MavLinkPacketSplitter {
    _transform(chunk: Buffer, encoding: string, callback: TransformCallback): void;
    protected findStartOfPacket(buffer: Buffer, offset?: number): number | null;
}
/**
 * A transform stream that takes a buffer with data and converts it to MavLinkPacket object
 */
export declare class MavLinkPacketParser extends Transform {
    protected readonly log: Logger;
    constructor(opts?: {});
    private getProtocol;
    _transform({ buffer, timestamp, ...rest }: {
        buffer?: Buffer | undefined;
        timestamp?: null | undefined;
    } | undefined, encoding: string, callback: TransformCallback): void;
}
/**
 * Creates a MavLink packet stream reader that is reading packets from the given input
 *
 * @param input input stream to read from
 */
export declare function createMavLinkStream(input: Readable, { onCrcError, magicNumbers }?: {
    onCrcError?: BufferCallback;
    magicNumbers?: Record<string, number>;
}): MavLinkPacketParser;
/**
 * Send a packet to the stream
 *
 * @param stream Stream to send the data to
 * @param msg message to serialize and send
 * @param protocol protocol to use (default: MavLinkProtocolV1)
 * @returns number of bytes sent
 */
export declare function send(stream: Writable, msg: MavLinkData, protocol?: MavLinkProtocol): Promise<unknown>;
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
export declare function sendSigned(stream: Writable, msg: MavLinkData, key: Buffer, linkId?: uint8_t, sysid?: uint8_t, compid?: uint8_t, timestamp?: number): Promise<unknown>;
export {};
//# sourceMappingURL=mavlink.d.ts.map