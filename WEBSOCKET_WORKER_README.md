# TypeScript WebSocket Worker

A complete TypeScript implementation of WebSocket connections running in Web Workers for React applications.

## Features

- **Web Worker Integration**: WebSocket connections run in a separate thread, preventing UI blocking
- **TypeScript Support**: Fully typed interfaces for type-safe development
- **Automatic Reconnection**: Configurable reconnection logic with exponential backoff
- **Message Queue**: Messages are queued when disconnected and sent when reconnected  
- **React Hook**: Custom `useWebSocketWorker` hook for easy React integration
- **Event-Driven Architecture**: Clean event-based communication between worker and main thread
- **Error Handling**: Comprehensive error handling with detailed error reporting
- **Connection Status**: Real-time connection status monitoring

## Project Structure

```
src/
├── types/
│   └── websocket-worker.types.ts    # TypeScript type definitions
├── workers/
│   ├── websocket-worker.ts          # Main WebSocket Worker class
│   └── websocket.worker.ts          # Worker script entry point
├── lib/
│   └── websocket-worker-client.ts   # Main thread client interface
├── components/
│   └── WebSocketWorkerDemo.tsx      # React demo component
└── websocket-worker.ts              # Public API exports
```

## Usage

### Basic Usage

```typescript
import { createWebSocketWorker } from './src/websocket-worker';

// Create worker client (worker is embedded, no separate file needed)
const wsWorker = createWebSocketWorker();

// Connect to WebSocket server
await wsWorker.connect({
  url: 'wss://echo.websocket.org',
  reconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 5
});

// Send message
wsWorker.sendMessage('Hello World!');

// Listen for messages
wsWorker.addEventListener('MESSAGE_RECEIVED', (event) => {
  console.log('Received:', event.payload.data);
});

// Disconnect
wsWorker.disconnect();
```

### React Hook Usage

#### Simple Hook (Auto-connecting)
```tsx
import { useWebSocketWorker } from './src/websocket-worker';

function MyComponent() {
  const {
    isConnected,
    lastMessage,
    sendMessage,
    disconnect,
    reconnect
  } = useWebSocketWorker(
    'wss://echo.websocket.org',          // WebSocket URL (auto-connects)
    {
      onMessage: (data) => console.log('Received:', data),
      onConnect: () => console.log('Connected!'),
      reconnect: true,
      maxReconnectAttempts: 3
    }
  );

  return (
    <div>
      <span>Status: {isConnected ? 'Connected' : 'Disconnected'}</span>
      <button onClick={() => sendMessage('Hello!')}>Send Message</button>
      {lastMessage && <div>Last: {lastMessage}</div>}
    </div>
  );
}
```

#### Advanced Hook (Manual Control)
```tsx
import { useWebSocketWorkerClient } from './src/websocket-worker';

function MyComponent() {
  const {
    status,
    connect,
    disconnect,
    sendMessage,
    isConnected
  } = useWebSocketWorkerClient({
    onMessage: (data) => console.log('Received:', data),
    onError: (error) => console.error('Error:', error)
  });

  const handleConnect = async () => {
    await connect({
      url: 'wss://echo.websocket.org',
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 5
    });
  };

  return (
    <div>
      <button onClick={handleConnect} disabled={isConnected}>
        Connect
      </button>
      <button onClick={disconnect} disabled={!isConnected}>
        Disconnect  
      </button>
      {/* ... rest of component */}
    </div>
  );
}
```

## API Reference

### React Hooks

#### useWebSocketWorker(websocketUrl?, options?)
Simplified hook that auto-connects when WebSocket URL is provided.

**Parameters:**
- `websocketUrl?: string` - WebSocket server URL (auto-connects if provided)
- `options?: object` - Connection and callback options

**Returns:**
- `isConnected: boolean` - Connection status
- `isConnecting: boolean` - Connection in progress
- `lastMessage: any` - Last received message
- `status: WebSocketStatus` - Full connection status
- `connect: (config) => Promise<void>` - Connect manually
- `disconnect: () => void` - Disconnect
- `sendMessage: (data) => void` - Send message
- `reconnect: () => Promise<void>` - Reconnect
- `clearLastMessage: () => void` - Clear last message

#### useWebSocketWorkerClient(options)
Advanced hook for full control over WebSocket Worker lifecycle.

**Options:**
- `autoConnect?: boolean` - Auto-connect on mount
- `connectionConfig?: WebSocketConfig` - Default connection configuration
- `onMessage?: (data) => void` - Message received callback
- `onConnect?: () => void` - Connection established callback
- `onDisconnect?: (event) => void` - Connection closed callback  
- `onError?: (error) => void` - Error occurred callback

**Returns:**
- `client: WebSocketWorkerClient | null` - Raw client instance
- `status: WebSocketStatus` - Connection status
- `isConnected: boolean` - Connection status
- `isConnecting: boolean` - Connection in progress
- `lastMessage: any` - Last received message
- `connect: (config) => Promise<void>` - Connect to server
- `disconnect: (code?, reason?) => void` - Disconnect from server
- `sendMessage: (data) => void` - Send message
- `reconnect: () => Promise<void>` - Reconnect
- `clearLastMessage: () => void` - Clear last message

### WebSocketWorkerClient

#### Methods

- `initWorker(workerUrl)` - Initialize the Web Worker
- `connect(config)` - Connect to WebSocket server
- `disconnect(code?, reason?)` - Disconnect from server
- `sendMessage(data)` - Send message through WebSocket
- `addEventListener(type, handler)` - Add event listener
- `removeEventListener(type, handler)` - Remove event listener
- `getStatus()` - Get current connection status
- `terminateWorker()` - Terminate the Web Worker

#### Events

- `CONNECTED` - WebSocket connection established
- `DISCONNECTED` - WebSocket connection closed
- `MESSAGE_RECEIVED` - Message received from server
- `ERROR` - Connection or protocol error
- `CONNECTION_STATE_CHANGED` - Connection state updated

### Configuration Options

```typescript
interface WebSocketConfig {
  url: string;                    // WebSocket server URL
  protocols?: string[];           // WebSocket subprotocols
  reconnect?: boolean;            // Enable automatic reconnection
  reconnectInterval?: number;     // Milliseconds between reconnect attempts
  maxReconnectAttempts?: number;  // Maximum reconnection attempts
}
```

### Connection Status

```typescript
interface WebSocketStatus {
  connected: boolean;           // Currently connected
  connecting: boolean;          // Connection in progress
  reconnecting: boolean;        // Reconnection in progress
  readyState: WebSocketState;   // Current WebSocket state
  url: string | null;           // Connected URL
  reconnectAttempts: number;    // Current reconnect attempt count
  lastError: string | null;     // Last error message
}
```

## Development

### Running the Demo

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start development server:
   ```bash
   pnpm dev
   ```

3. Open browser and navigate to the demo page

### Testing WebSocket Connection

The demo includes a WebSocket echo server for testing:
- Default server: `wss://echo.websocket.org`
- Send messages and see them echoed back
- Test reconnection by disconnecting and reconnecting

### Building for Production

```bash
pnpm build
```

## Implementation Details

### Worker Architecture

The WebSocket Worker runs in a separate thread using the Web Workers API:

1. **Main Thread**: Handles UI and user interactions
2. **Worker Thread**: Manages WebSocket connections and message processing
3. **Message Passing**: Structured communication using TypeScript interfaces

### Message Queue

Messages sent while disconnected are automatically queued and delivered when the connection is re-established.

### Reconnection Logic

- Configurable reconnection attempts with exponential backoff
- Automatic status updates during reconnection process
- Graceful handling of connection failures

### Error Handling

Comprehensive error handling for:
- Worker initialization failures
- WebSocket connection errors
- Message sending failures
- Protocol errors

## Browser Support

- Modern browsers with Web Workers support
- WebSocket API support
- ES2015+ features

## License

MIT License - see LICENSE file for details.