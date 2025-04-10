"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MavEsp8266 = void 0;
const events_1 = require("events");
const dgram_1 = require("dgram");
const stream_1 = require("stream");
const mavlink_1 = require("./mavlink");
const mavlink_2 = require("./mavlink");
const utils_1 = require("./utils");
/**
 * Encapsulation of communication with MavEsp8266
 */
class MavEsp8266 extends events_1.EventEmitter {
    input;
    socket;
    ip = "";
    sendPort = 14555;
    seq = 0;
    /**
     * @param splitter packet splitter instance
     * @param parser packet parser instance
     * @param ftp optional FTP instance for file transfer
     */
    constructor({ splitter = new mavlink_1.MavLinkPacketSplitter(), parser = new mavlink_1.MavLinkPacketParser(), ftp, } = {}) {
        super();
        this.input = new stream_1.PassThrough();
        this.processIncomingUDPData = this.processIncomingUDPData.bind(this);
        this.processIncomingPacket = this.processIncomingPacket.bind(this);
        // Create the reader as usual by piping the source stream through the splitter
        // and packet parser
        let reader;
        if (splitter && parser) {
            reader = this.input.pipe(splitter).pipe(parser);
            reader.on("data", this.processIncomingPacket);
        }
        else if (splitter && parser && ftp) {
            reader = this.input.pipe(splitter).pipe(parser).pipe(ftp);
            reader.on("data", this.processIncomingPacket);
        }
    }
    /**
     * Start communication with the controller via MAVESP8266
     *
     * @param receivePort port to receive messages on (default: 14550)
     * @param sendPort port to send messages to (default: 14555)
     * @param ip IP address to send to in case there is no broadcast (default: empty string)
     */
    async start(receivePort = 14550, sendPort = 14555, ip = "") {
        this.sendPort = sendPort;
        this.ip = ip;
        // Create a UDP socket
        this.socket = (0, dgram_1.createSocket)({ type: "udp4", reuseAddr: true });
        this.socket.on("message", this.processIncomingUDPData);
        // Start listening on the socket
        return new Promise((resolve, reject) => {
            this.socket?.bind(receivePort, () => {
                // Wait for the first package to be returned to read the ip address
                // of the controller
                (0, utils_1.waitFor)(() => this.ip !== "")
                    .then(() => {
                    resolve({ ip: this.ip, sendPort, receivePort });
                })
                    .catch((e) => {
                    reject(e);
                });
            });
        });
    }
    /**
     * Closes the client stopping any message handlers
     */
    async close() {
        if (!this.socket)
            throw new Error("Not connected");
        // Unregister event handlers
        this.socket.off("message", this.processIncomingUDPData);
        // Close the socket
        return new Promise((resolve) => {
            this.socket?.close(resolve);
        });
    }
    /**
     * Send a packet
     *
     * @param msg message to send
     * @param sysid system id
     * @param compid component id
     */
    async send(msg, sysid = mavlink_2.MavLinkProtocol.SYS_ID, compid = mavlink_2.MavLinkProtocol.COMP_ID) {
        const protocol = new mavlink_2.MavLinkProtocolV2(sysid, compid);
        const buffer = protocol.serialize(msg, this.seq++);
        this.seq &= 255;
        return this.sendBuffer(buffer);
    }
    /**
     * Send a signed packet
     *
     * @param msg message to send
     * @param sysid system id
     * @param compid component id
     * @param linkId link id for the signature
     */
    async sendSigned(msg, key, linkId = 1, sysid = mavlink_2.MavLinkProtocol.SYS_ID, compid = mavlink_2.MavLinkProtocol.COMP_ID) {
        const protocol = new mavlink_2.MavLinkProtocolV2(sysid, compid, mavlink_2.MavLinkProtocolV2.IFLAG_SIGNED);
        const b1 = protocol.serialize(msg, this.seq++);
        this.seq &= 255;
        const b2 = protocol.sign(b1, linkId, key);
        return this.sendBuffer(b2);
    }
    /**
     * Send raw data over the socket. Useful for custom implementation of data sending
     *
     * @param buffer buffer to send
     */
    async sendBuffer(buffer) {
        return new Promise((resolve, reject) => {
            this.socket?.send(buffer, this.sendPort, this.ip, (err, bytes) => {
                if (err)
                    reject(err);
                else
                    resolve(bytes);
            });
        });
    }
    processIncomingUDPData(buffer, metadata) {
        // store the remote ip address
        if (this.ip === "")
            this.ip = metadata.address;
        // pass on the data to the input stream
        this.input.write(buffer);
    }
    processIncomingPacket(packet) {
        // let the user know we received the packet
        this.emit("data", packet);
    }
}
exports.MavEsp8266 = MavEsp8266;
