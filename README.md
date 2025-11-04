# React 18 + TypeScript + Vite Project

A React 18 TypeScript application built with Vite and pnpm.

## Project Setup

- **React**: 18.x
- **TypeScript**: 5.1.3  
- **Vite**: 5.4.8
- **Node.js**: 20.9.0
- **Package Manager**: pnpm

## Getting Started

1. Install pnpm globally (if not already installed):
   ```bash
   npm install -g pnpm
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Start the development server:
   ```bash
   pnpm dev
   ```

4. Build for production:
   ```bash
   pnpm build
   ```

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm lint` - Run ESLint
- `pnpm preview` - Preview production build

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

# TypeScript WebSocket Worker

A complete TypeScript implementation of WebSocket connections running in Web Workers for React applications, built with React 18, TypeScript 5.1.3, Vite 5.4.8, and pnpm.

## Features

- **🚀 Web Worker Integration**: WebSocket connections run in a separate thread, preventing UI blocking
- **🛡️ TypeScript Support**: Fully typed interfaces with const assertions for type-safe development  
- **🔄 Automatic Reconnection**: Configurable reconnection logic with exponential backoff
- **📨 Message Queue**: Messages are queued when disconnected and sent when reconnected  
- **⚛️ React Hooks**: Custom hooks for seamless React integration
- **📡 Event-Driven Architecture**: Clean event-based communication between worker and main thread
- **⚠️ Comprehensive Error Handling**: Detailed error reporting and graceful failure handling
- **📊 Real-time Status**: Live connection status monitoring and state management
- **🎯 Auto-Initialization**: Worker automatically initializes when loaded in Web Worker context

## Project Structure

```
src/
├── workers/
│   ├── WebSocketWorker.ts           # Main client class + types (main thread)
│   └── WebSocketWorkerImpl.ts       # Worker implementation (worker thread)
├── hooks/
│   └── useWebSocketWorker.ts        # React hooks for WebSocket Worker
├── components/
│   └── WebSocketWorkerDemo.tsx      # Complete demo component
└── App.tsx                          # Main application
```

## Quick Start

### Installation

```bash
# Clone and install dependencies
pnpm install

# Start development server  
pnpm dev
```

### Basic Usage

```typescript
import { WebSocketWorker } from './src/workers/WebSocketWorker';

// Create worker client (worker auto-initializes)
const wsWorker = new WebSocketWorker();

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

## React Integration

### Simple Hook (Auto-connecting)

```tsx
import { useWebSocketWorker } from './src/hooks/useWebSocketWorker';

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

### Advanced Hook (Manual Control)

```tsx
import { useWebSocketWorkerClient } from './src/hooks/useWebSocketWorker';

function MyComponent() {
  const {
    status,
    connect,
    disconnect,
    sendMessage,
    isConnected,
    isConnecting
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
      <button onClick={handleConnect} disabled={isConnected || isConnecting}>
        Connect
      </button>
      <button onClick={disconnect} disabled={!isConnected}>
        Disconnect  
      </button>
      <span>Status: {status.connected ? 'Connected' : 'Disconnected'}</span>
      {status.lastError && <div>Error: {status.lastError}</div>}
    </div>
  );
}
```

## API Reference

### React Hooks

#### `useWebSocketWorker(websocketUrl?, options?)`
Simplified hook that auto-connects when WebSocket URL is provided.

**Parameters:**
- `websocketUrl?: string` - WebSocket server URL (auto-connects if provided)
- `options?: UseWebSocketWorkerOptions` - Connection and callback options

**Returns:** `UseWebSocketWorkerReturn`
- `isConnected: boolean` - Connection status
- `isConnecting: boolean` - Connection in progress
- `lastMessage: any` - Last received message
- `status: WebSocketStatus` - Full connection status
- `connect: (config?) => Promise<void>` - Connect manually
- `disconnect: (code?, reason?) => void` - Disconnect
- `sendMessage: (data) => void` - Send message
- `reconnect: () => Promise<void>` - Reconnect
- `clearLastMessage: () => void` - Clear last message

#### `useWebSocketWorkerClient(options)`
Advanced hook for full control over WebSocket Worker lifecycle.

**Options:** `UseWebSocketWorkerOptions`
- `autoConnect?: boolean` - Auto-connect on mount
- `connectionConfig?: WebSocketConfig` - Default connection configuration
- `onMessage?: (data: any) => void` - Message received callback
- `onConnect?: () => void` - Connection established callback
- `onDisconnect?: (event) => void` - Connection closed callback  
- `onError?: (error: string) => void` - Error occurred callback

### WebSocketWorker Class

The main client class that runs in the main thread and manages the Web Worker.

#### Constructor
```typescript
new WebSocketWorker()  // Auto-initializes worker at /src/workers/WebSocketWorkerImpl.js
```

#### Methods
- `connect(config: WebSocketConfig): Promise<void>` - Connect to WebSocket server
- `disconnect(code?: number, reason?: string): void` - Disconnect from server
- `sendMessage(data: string | ArrayBuffer | Blob): void` - Send message
- `addEventListener(type: string, handler: Function): void` - Add event listener
- `removeEventListener(type: string, handler: Function): void` - Remove event listener
- `once(type: string, handler: Function): void` - Add one-time event listener
- `getStatus(): WebSocketStatus` - Get current connection status
- `isConnected(): boolean` - Check if connected
- `isConnecting(): boolean` - Check if connecting
- `terminateWorker(): void` - Terminate the Web Worker

#### Events
- `CONNECTED` - WebSocket connection established
- `DISCONNECTED` - WebSocket connection closed
- `MESSAGE_RECEIVED` - Message received from server
- `ERROR` - Connection or protocol error
- `CONNECTION_STATE_CHANGED` - Connection state updated

### Type Definitions

#### `WebSocketConfig`
```typescript
interface WebSocketConfig {
  url: string;                    // WebSocket server URL
  protocols?: string[];           // WebSocket subprotocols
  reconnect?: boolean;            // Enable automatic reconnection (default: true)
  reconnectInterval?: number;     // Milliseconds between reconnect attempts (default: 3000)
  maxReconnectAttempts?: number;  // Maximum reconnection attempts (default: 5)
}
```

#### `WebSocketStatus`
```typescript
interface WebSocketStatus {
  connected: boolean;           // Currently connected
  connecting: boolean;          // Connection in progress
  reconnecting: boolean;        // Reconnection in progress
  readyState: WebSocketState;   // Current WebSocket state (0-3)
  url: string | null;           // Connected URL
  reconnectAttempts: number;    // Current reconnect attempt count
  lastError: string | null;     // Last error message
}
```

#### `WebSocketState`
```typescript
const WebSocketState = {
  CONNECTING: 0,  // Connection is being established
  OPEN: 1,        // Connection is open and ready
  CLOSING: 2,     // Connection is being closed
  CLOSED: 3       // Connection is closed
} as const;
```

## Architecture

### Two-File Design

1. **`WebSocketWorker.ts`** - Main thread client class with embedded worker management
   - Contains all type definitions using const assertions (better than enums)
   - Manages Web Worker lifecycle and communication
   - Provides event-driven API for the main thread

2. **`WebSocketWorkerImpl.ts`** - Web Worker implementation  
   - Auto-initializes when loaded in Web Worker context
   - Handles actual WebSocket connections and message processing
   - Manages reconnection logic and message queuing

### Worker Communication

Communication between main thread and worker uses structured message passing:

```typescript
// Command from main thread to worker
{
  type: 'CONNECT',
  payload: { url: 'wss://example.com', protocols: ['protocol1'] }
}

// Event from worker to main thread  
{
  type: 'MESSAGE_RECEIVED',
  payload: { data: 'Hello World', origin: 'wss://example.com' }
}
```

### Message Queue

Messages sent while disconnected are automatically queued and delivered when the connection is re-established, ensuring no message loss.

### Reconnection Logic

- Configurable retry attempts with exponential backoff
- Automatic status updates during reconnection process
- Graceful handling of connection failures
- Respects maximum retry limits

### Error Handling

Comprehensive error handling for:
- Worker initialization failures
- WebSocket connection errors  
- Message sending failures
- Protocol errors
- Network timeouts

## Development

### Tech Stack
- **React**: 18.2.0
- **TypeScript**: 5.1.3  
- **Vite**: 5.4.8
- **Node.js**: 20.9.0
- **Package Manager**: pnpm

### Scripts
```bash
pnpm dev      # Start development server
pnpm build    # Build for production  
pnpm lint     # Run ESLint
pnpm preview  # Preview production build
```

### Testing WebSocket Connection

The demo includes a WebSocket echo server for testing:
- Default server: `wss://echo.websocket.org`
- Send messages and see them echoed back
- Test reconnection by disconnecting and reconnecting
- Monitor connection status and error states

### VS Code Integration

The project includes VS Code configurations:
- **Debug configurations** for Chrome/Edge debugging
- **Task definitions** for development server
- **TypeScript support** with proper source maps

## Browser Support

- Modern browsers with Web Workers support
- WebSocket API support  
- ES2015+ features
- Vite's browser compatibility

## Performance Benefits

- **Non-blocking UI**: WebSocket operations run in separate thread
- **Efficient bundling**: Tree-shakable const assertions vs traditional enums
- **Memory efficient**: Automatic cleanup of event listeners and workers
- **Fast development**: Vite's fast HMR and TypeScript integration

## License

MIT License - see LICENSE file for details.
