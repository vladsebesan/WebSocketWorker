import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketWorker } from '../workers/WebSocketWorker';
import { WebSocketState } from '../workers/WebSocketWorker';
import type { 
  WebSocketStatus, 
  WebSocketWorkerEvent, 
  WebSocketConfig 
} from '../workers/WebSocketWorker';

interface UseWebSocketWorkerOptions {
  workerUrl?: string | URL;
  autoConnect?: boolean;
  connectionConfig?: WebSocketConfig;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: (event: { code: number; reason: string; wasClean: boolean }) => void;
  onError?: (error: string) => void;
}

interface UseWebSocketWorkerReturn {
  client: WebSocketWorker | null;
  status: WebSocketStatus;
  isConnected: boolean;
  isConnecting: boolean;
  lastMessage: any;
  connect: (config?: WebSocketConfig) => Promise<void>;
  disconnect: (code?: number, reason?: string) => void;
  sendMessage: (data: string | ArrayBuffer | Blob) => void;
  reconnect: () => Promise<void>;
  clearLastMessage: () => void;
}

/**
 * React hook for managing WebSocketWorkerClient
 * Provides a complete interface for WebSocket connections in Web Workers
 */
export function useWebSocketWorkerClient(options: UseWebSocketWorkerOptions): UseWebSocketWorkerReturn {
  const {
    autoConnect = false,
    connectionConfig,
    onMessage,
    onConnect,
    onDisconnect,
    onError
  } = options;

  // State management
  const [client, setClient] = useState<WebSocketWorker | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>({
    connected: false,
    connecting: false,
    reconnecting: false,
    readyState: WebSocketState.CLOSED,
    url: null,
    reconnectAttempts: 0,
    lastError: null
  });
  const [lastMessage, setLastMessage] = useState<any>(null);

  // Refs for stable callback references
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);
  const connectionConfigRef = useRef(connectionConfig);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onConnectRef.current = onConnect;
  }, [onConnect]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    connectionConfigRef.current = connectionConfig;
  }, [connectionConfig]);

  // Initialize WebSocket Worker Client
  useEffect(() => {
    let wsClient: WebSocketWorker | null = null;

    const initializeClient = async () => {
      try {
        wsClient = new WebSocketWorker();

        // Set up event listeners
        wsClient.addEventListener('CONNECTED', (event: WebSocketWorkerEvent) => {
          if (event.type === 'CONNECTED') {
            setStatus(wsClient!.getStatus());
            onConnectRef.current?.();
          }
        });

        wsClient.addEventListener('DISCONNECTED', (event: WebSocketWorkerEvent) => {
          if (event.type === 'DISCONNECTED') {
            setStatus(wsClient!.getStatus());
            onDisconnectRef.current?.(event.payload);
          }
        });

        wsClient.addEventListener('MESSAGE_RECEIVED', (event: WebSocketWorkerEvent) => {
          if (event.type === 'MESSAGE_RECEIVED') {
            setLastMessage(event.payload.data);
            onMessageRef.current?.(event.payload.data);
          }
        });

        wsClient.addEventListener('ERROR', (event: WebSocketWorkerEvent) => {
          if (event.type === 'ERROR') {
            setStatus(wsClient!.getStatus());
            onErrorRef.current?.(event.payload.error);
          }
        });

        wsClient.addEventListener('CONNECTION_STATE_CHANGED', (event: WebSocketWorkerEvent) => {
          if (event.type === 'CONNECTION_STATE_CHANGED') {
            setStatus(wsClient!.getStatus());
          }
        });

        setClient(wsClient);

        // Auto-connect if specified
        if (autoConnect && connectionConfigRef.current) {
          await wsClient.connect(connectionConfigRef.current);
        }
      } catch (error) {
        console.error('Failed to initialize WebSocket Worker Client:', error);
        onErrorRef.current?.(
          `Failed to initialize worker: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    initializeClient();

    // Cleanup on unmount
    return () => {
      if (wsClient) {
        wsClient.terminateWorker();
      }
    };
  }, [autoConnect]);

  // Connect function
  const connect = useCallback(async (config?: WebSocketConfig) => {
    if (!client) {
      throw new Error('WebSocket Worker Client not initialized');
    }

    const connectConfig = config || connectionConfigRef.current;
    if (!connectConfig) {
      throw new Error('No connection configuration provided');
    }

    try {
      await client.connect(connectConfig);
    } catch (error) {
      console.error('Connection failed:', error);
      throw error;
    }
  }, [client]);

  // Disconnect function
  const disconnect = useCallback((code?: number, reason?: string) => {
    if (!client) {
      console.warn('WebSocket Worker Client not initialized');
      return;
    }

    try {
      client.disconnect(code, reason);
    } catch (error) {
      console.error('Disconnect failed:', error);
      onErrorRef.current?.(
        `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [client]);

  // Send message function
  const sendMessage = useCallback((data: string | ArrayBuffer | Blob) => {
    if (!client) {
      throw new Error('WebSocket Worker Client not initialized');
    }

    if (!status.connected) {
      throw new Error('WebSocket is not connected');
    }

    try {
      client.sendMessage(data);
    } catch (error) {
      console.error('Send message failed:', error);
      throw error;
    }
  }, [client, status.connected]);

  // Reconnect function
  const reconnect = useCallback(async () => {
    if (!connectionConfigRef.current) {
      throw new Error('No connection configuration available for reconnection');
    }

    // Disconnect first if connected
    if (status.connected) {
      disconnect();
      // Wait a bit for disconnection to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Then reconnect
    await connect(connectionConfigRef.current);
  }, [connect, disconnect, status.connected]);

  // Clear last message function
  const clearLastMessage = useCallback(() => {
    setLastMessage(null);
  }, []);

  return {
    client,
    status,
    isConnected: status.connected,
    isConnecting: status.connecting,
    lastMessage,
    connect,
    disconnect,
    sendMessage,
    reconnect,
    clearLastMessage
  };
}

/**
 * Simplified hook for basic WebSocket Worker usage
 * Automatically connects on mount if URL is provided
 */
export function useWebSocketWorker(websocketUrl?: string, options?: {
  workerUrl?: string | URL;
  protocols?: string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: (event: { code: number; reason: string; wasClean: boolean }) => void;
  onError?: (error: string) => void;
}) {
  const connectionConfig = websocketUrl ? {
    url: websocketUrl,
    protocols: options?.protocols,
    reconnect: options?.reconnect ?? true,
    reconnectInterval: options?.reconnectInterval ?? 3000,
    maxReconnectAttempts: options?.maxReconnectAttempts ?? 5
  } : undefined;

  return useWebSocketWorkerClient({
    workerUrl: options?.workerUrl,
    autoConnect: !!websocketUrl,
    connectionConfig,
    onMessage: options?.onMessage,
    onConnect: options?.onConnect,
    onDisconnect: options?.onDisconnect,
    onError: options?.onError
  });
}