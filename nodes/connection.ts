import { Socket, io } from "socket.io-client"
import { Logger } from "../utils/Logger"
import { NodeConfig, NodeLocation } from "./node"

export interface ConnectionCallbacks {
    add: (data: unknown) => void
    delete: (data: unknown) => void
    update: (data: unknown) => void
    metaQuery: (data: unknown) => void
    fileQuery: (data: unknown) => void
}

export class Connection {
    serverLocation: NodeLocation
    nodeConfig: NodeConfig
    logger: Logger
    socket: Socket | null = null

    constructor(serverLocation: NodeLocation, nodeConfig: NodeConfig, logger: Logger) {
        this.serverLocation = serverLocation
        this.nodeConfig = nodeConfig
        this.logger = logger

    }

    init(callbacks: ConnectionCallbacks) {
        return new Promise((resolve, reject) => {
            this.logger.log("Connecting to server....")

            this.socket = io(`http://${this.serverLocation.address}:${this.serverLocation.port}`)

            this.socket.on("connect", () => {
                this.logger.log("Connected!")
                resolve(true)
            })

            this.socket.on("connect_error", (e) => {
                reject(new Error(`Connection error: ${e.message}`))
            })

            this.socket.on("connect_failed", (e) => {
                reject(new Error(`Connection failed error: ${e.message}`))
            })

            this.socket.on("ADD", callbacks.add)
            this.socket.on("DELETE", callbacks.delete)
            this.socket.on("UPDATE", callbacks.update)
            this.socket.on("MetaQuery", callbacks.metaQuery)
            this.socket.on("FileQuery", callbacks.fileQuery)
        })
    }

    ping(pingData: unknown) {
        this.socket?.emit("ping", pingData)
    }

}
