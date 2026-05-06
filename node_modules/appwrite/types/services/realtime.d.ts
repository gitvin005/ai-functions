import { Client } from '../client';
import { Channel, ActionableChannel, ResolvedChannel } from '../channel';
import { Query } from '../query';
export type RealtimeSubscriptionUpdate = {
    channels?: (string | Channel<any> | ActionableChannel | ResolvedChannel)[];
    queries?: (string | Query)[];
};
export type RealtimeSubscription = {
    /**
     * Remove this subscription only. Keeps the WebSocket open so other subscriptions keep receiving events.
     * Use `Realtime.disconnect()` to close the connection entirely.
     */
    unsubscribe: () => Promise<void>;
    /**
     * Replace the channels and/or queries for this subscription on the server without re-creating it.
     */
    update: (changes: RealtimeSubscriptionUpdate) => Promise<void>;
    /**
     * Alias of `unsubscribe()` plus legacy auto-disconnect when this was the last active subscription.
     * Prefer `unsubscribe()` for per-subscription teardown and `Realtime.disconnect()` for full shutdown.
     */
    close: () => Promise<void>;
};
export type RealtimeCallback<T = any> = {
    channels: Set<string>;
    queries: string[];
    callback: (event: RealtimeResponseEvent<T>) => void;
};
export type RealtimeResponse = {
    type: string;
    data?: any;
};
export type RealtimeResponseEvent<T = any> = {
    events: string[];
    channels: string[];
    timestamp: string;
    payload: T;
    subscriptions: string[];
};
export type RealtimeResponseConnected = {
    channels: string[];
    user?: object;
};
export type RealtimeRequest = {
    type: 'authentication' | 'subscribe' | 'unsubscribe';
    data: any;
};
export declare enum RealtimeCode {
    NORMAL_CLOSURE = 1000,
    POLICY_VIOLATION = 1008,
    UNKNOWN_ERROR = -1
}
export declare class Realtime {
    private readonly TYPE_ERROR;
    private readonly TYPE_EVENT;
    private readonly TYPE_PONG;
    private readonly TYPE_CONNECTED;
    private readonly TYPE_RESPONSE;
    private readonly DEBOUNCE_MS;
    private readonly HEARTBEAT_INTERVAL;
    private client;
    private socket?;
    private activeSubscriptions;
    private pendingSubscribes;
    private heartbeatTimer?;
    private subCallDepth;
    private reconnectAttempts;
    private connectionId;
    private reconnect;
    private onErrorCallbacks;
    private onCloseCallbacks;
    private onOpenCallbacks;
    constructor(client: Client);
    /**
     * Register a callback function to be called when an error occurs
     *
     * @param {Function} callback - Callback function to handle errors
     * @returns {void}
     */
    onError(callback: (error?: Error, statusCode?: number) => void): void;
    /**
     * Register a callback function to be called when the connection closes
     *
     * @param {Function} callback - Callback function to handle connection close
     * @returns {void}
     */
    onClose(callback: () => void): void;
    /**
     * Register a callback function to be called when the connection opens
     *
     * @param {Function} callback - Callback function to handle connection open
     * @returns {void}
     */
    onOpen(callback: () => void): void;
    private startHeartbeat;
    private stopHeartbeat;
    private createSocket;
    private closeSocket;
    private getTimeout;
    private sleep;
    private sendUnsubscribeMessage;
    private generateUniqueSubscriptionId;
    private enqueuePendingSubscribe;
    /**
     * Close the WebSocket connection and drop all active subscriptions client-side.
     * Use this instead of calling `unsubscribe()` on every subscription when you want to tear everything down.
     */
    disconnect(): Promise<void>;
    private sendPendingSubscribes;
    /**
     * Convert a channel value to a string
     *
     * @private
     * @param {string | Channel<any> | ActionableChannel | ResolvedChannel} channel - Channel value (string or Channel builder instance)
     * @returns {string} Channel string representation
     */
    private channelToString;
    /**
     * Subscribe to a single channel
     *
     * @param {string | Channel<any> | ActionableChannel | ResolvedChannel} channel - Channel name to subscribe to (string or Channel builder instance)
     * @param {Function} callback - Callback function to handle events
     * @returns {Promise<RealtimeSubscription>} Subscription object with close method
     */
    subscribe(channel: string | Channel<any> | ActionableChannel | ResolvedChannel, callback: (event: RealtimeResponseEvent<any>) => void, queries?: (string | Query)[]): Promise<RealtimeSubscription>;
    /**
     * Subscribe to multiple channels
     *
     * @param {(string | Channel<any> | ActionableChannel | ResolvedChannel)[]} channels - Array of channel names to subscribe to (strings or Channel builder instances)
     * @param {Function} callback - Callback function to handle events
     * @returns {Promise<RealtimeSubscription>} Subscription object with close method
     */
    subscribe(channels: (string | Channel<any> | ActionableChannel | ResolvedChannel)[], callback: (event: RealtimeResponseEvent<any>) => void, queries?: (string | Query)[]): Promise<RealtimeSubscription>;
    /**
     * Subscribe to a single channel with typed payload
     *
     * @param {string | Channel<any> | ActionableChannel | ResolvedChannel} channel - Channel name to subscribe to (string or Channel builder instance)
     * @param {Function} callback - Callback function to handle events with typed payload
     * @returns {Promise<RealtimeSubscription>} Subscription object with close method
     */
    subscribe<T>(channel: string | Channel<any> | ActionableChannel | ResolvedChannel, callback: (event: RealtimeResponseEvent<T>) => void, queries?: (string | Query)[]): Promise<RealtimeSubscription>;
    /**
     * Subscribe to multiple channels with typed payload
     *
     * @param {(string | Channel<any> | ActionableChannel | ResolvedChannel)[]} channels - Array of channel names to subscribe to (strings or Channel builder instances)
     * @param {Function} callback - Callback function to handle events with typed payload
     * @returns {Promise<RealtimeSubscription>} Subscription object with close method
     */
    subscribe<T>(channels: (string | Channel<any> | ActionableChannel | ResolvedChannel)[], callback: (event: RealtimeResponseEvent<T>) => void, queries?: (string | Query)[]): Promise<RealtimeSubscription>;
    private handleMessage;
    private handleResponseConnected;
    private handleResponseError;
    private handleResponseEvent;
    private handleResponseAction;
}
