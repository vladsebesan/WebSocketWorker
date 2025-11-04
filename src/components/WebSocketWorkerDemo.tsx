import { useState, useEffect, useRef } from 'react';
import { useWebSocketWorkerClient } from '../hooks/useWebSocketWorker';

/**
 * WebSocket Worker Demo Component
 */
export default function WebSocketWorkerDemo() {
  const [serverUrl, setServerUrl] = useState('wss://echo.websocket.org');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<Array<{
    id: number;
    data: any;
    timestamp: Date;
    type: 'sent' | 'received';
  }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize the WebSocket Worker with the worker script
  const {
    status,
    connect,
    disconnect,
    sendMessage,
    isConnected,
    isConnecting
  } = useWebSocketWorkerClient({
    onMessage: (data) => {
      setMessages(prev => [...prev, {
        id: Date.now(),
        data,
        timestamp: new Date(),
        type: 'received'
      }]);
    },
    onConnect: () => {
      console.log('WebSocket connected');
    },
    onDisconnect: (event) => {
      console.log('WebSocket disconnected:', event);
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
    }
  });

  // Auto scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleConnect = async () => {
    if (!serverUrl) return;

    try {
      await connect({
        url: serverUrl,
        reconnect: true,
        reconnectInterval: 3000,
        maxReconnectAttempts: 5
      });
    } catch (error) {
      alert('Failed to connect: ' + (error as Error).message);
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;

    try {
      // Add message to local state for sent messages
      setMessages(prev => [...prev, {
        id: Date.now(),
        data: messageInput,
        timestamp: new Date(),
        type: 'sent'
      }]);
      
      sendMessage(messageInput);
      setMessageInput('');
    } catch (error) {
      alert('Failed to send message: ' + (error as Error).message);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const getStatusColor = () => {
    if (isConnected) return 'text-green-600';
    if (isConnecting) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusText = () => {
    if (isConnected) return 'Connected';
    if (isConnecting) return 'Connecting...';
    if (status.reconnecting) return 'Reconnecting...';
    return 'Disconnected';
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Connection Controls */}
      <div className="mb-6 p-4 border rounded-lg bg-gray-50">
        <div className="flex items-center gap-4 mb-3">
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="WebSocket Server URL"
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isConnected || isConnecting}
          />
          
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isConnecting}
            className={`px-4 py-2 rounded-md font-medium ${
              isConnected
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400'
            }`}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        
        <div className="text-sm">
          <span className="text-gray-600">Status: </span>
          <span className={getStatusColor()}>{getStatusText()}</span>
          {status.url && (
            <>
              <span className="text-gray-600 ml-4">URL: </span>
              <span className="text-gray-800">{status.url}</span>
            </>
          )}
        </div>
        
        {status.lastError && (
          <div className="mt-2 text-sm text-red-600">
            Error: {status.lastError}
          </div>
        )}
        
        {status.reconnectAttempts > 0 && (
          <div className="mt-2 text-sm text-yellow-600">
            Reconnect attempts: {status.reconnectAttempts}
          </div>
        )}
      </div>

      {/* Message Controls */}
      <div className="mb-6 p-4 border rounded-lg bg-gray-50">
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="Enter message to send"
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!isConnected}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          
          <button
            onClick={handleSendMessage}
            disabled={!isConnected || !messageInput.trim()}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-md font-medium"
          >
            Send
          </button>
          
          <button
            onClick={clearMessages}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md font-medium"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages Display */}
      <div className="border rounded-lg bg-gray-50">
        <h2 className="text-lg font-semibold p-4 border-b bg-gray-100">
          Messages ({messages.length})
        </h2>
        
        <div className="h-80 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="text-gray-500 text-center">No messages yet</div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`mb-3 p-3 rounded-lg ${
                  message.type === 'sent'
                    ? 'bg-blue-100 ml-8'
                    : 'bg-green-100 mr-8'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className={`font-medium text-sm ${
                    message.type === 'sent' ? 'text-blue-700' : 'text-green-700'
                  }`}>
                    {message.type === 'sent' ? 'Sent' : 'Received'}
                  </span>
                  <span className="text-xs text-gray-500">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-gray-800 break-words">
                  {typeof message.data === 'string' 
                    ? message.data 
                    : JSON.stringify(message.data, null, 2)
                  }
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Debug Info */}
      <details className="mt-6">
        <summary className="cursor-pointer text-lg font-semibold">Debug Information</summary>
        <pre className="mt-3 p-4 bg-gray-100 rounded-lg text-sm overflow-x-auto">
          {JSON.stringify(status, null, 2)}
        </pre>
      </details>
    </div>
  );
}