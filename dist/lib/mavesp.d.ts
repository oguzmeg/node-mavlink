/// <reference types="node" />
/// <reference types="node" />
import { EventEmitter } from "events";
import { MavLinkPacketSplitter, MavLinkPacketParser } from "./mavlink";
import { uint8_t, MavLinkData } from "mavlink-mappings";
export interface ConnectionInfo {
    ip: string;
    sendPort: number;
    receivePort: number;
}
/**
 * Encapsulation of communication with MavEsp8266
 */
export declare class MavEsp8266 extends EventEmitter {
    private input;
    private socket?;
    private ip;
    private sendPort;
    private seq;
    /**
     * @param splitter packet splitter instance
     * @param parser packet parser instance
     * @param ftp optional FTP instance for file transfer
     */
    constructor({ splitter, parser, ftp, }?: {
        splitter?: MavLinkPacketSplitter;
        parser?: MavLinkPacketParser;
        ftp?: any;
    });
    /**
     * Start communication with the controller via MAVESP8266
     *
     * @param receivePort port to receive messages on (default: 14550)
     * @param sendPort port to send messages to (default: 14555)
     * @param ip IP address to send to in case there is no broadcast (default: empty string)
     */
    start(receivePort?: number, sendPort?: number, ip?: string): Promise<ConnectionInfo>;
    /**
     * Closes the client stopping any message handlers
     */
    close(): Promise<void>;
    /**
     * Send a packet
     *
     * @param msg message to send
     * @param sysid system id
     * @param compid component id
     */
    send(msg: MavLinkData, sysid?: uint8_t, compid?: uint8_t): Promise<number>;
    /**
     * Send a signed packet
     *
     * @param msg message to send
     * @param sysid system id
     * @param compid component id
     * @param linkId link id for the signature
     */
    sendSigned(msg: MavLinkData, key: Buffer, linkId?: uint8_t, sysid?: uint8_t, compid?: uint8_t): Promise<number>;
    /**
     * Send raw data over the socket. Useful for custom implementation of data sending
     *
     * @param buffer buffer to send
     */
    sendBuffer(buffer: Buffer): Promise<number>;
    private processIncomingUDPData;
    private processIncomingPacket;
}
//# sourceMappingURL=mavesp.d.ts.map