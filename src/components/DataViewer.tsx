import { useEffect, useState } from "react";
import type { IFlowModel, IToolboxModel } from "../interfaces/IFlow";
import { usePiApi } from "../custom-communication/PiApi";

export const DataViewer = () : JSX.Element => {
  const piApi = usePiApi();
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbox, setToolbox] = useState<IToolboxModel | null>(null);
  const [flow, setFlow] = useState<IFlowModel | null>(null);
  
  useEffect(() => {
    if (!piApi) return;

    // Setup connection callbacks
    piApi.onConnected = async () => {
      setIsConnected(true);
      setError(null);

      // Fetch data after connection
      try {
        const [toolboxData, flowData] = await Promise.all([
          piApi.getToolbox(),
          piApi.getFlow()
        ]);
        
        setToolbox(toolboxData);
        setFlow(flowData);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
        setError(errorMsg);
      }
    };

    piApi.onConnectionError = (err) => {
      setError(err.message);
      setIsConnected(false);
    };

    piApi.onDisconnected = () => {
      setIsConnected(false);
      setToolbox(null);
      setFlow(null);
    };

    // Cleanup
    return () => {
      piApi.onConnected = null;
      piApi.onConnectionError = null;
      piApi.onDisconnected = null;
    };
  }, [piApi]);

  const handleConnect = () => {
    if (!piApi || isConnected) return;
    setError(null);
    piApi.connect();
  };

  const handleDisconnect = () => {
    if (!piApi || !isConnected) return;
    piApi.disconnect();
  };

  // Handle loading state while piApi is initializing
  if (!piApi) {
    return <div>Loading PIApi...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Data Viewer Component</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={handleConnect} 
          disabled={isConnected}
          style={{ marginRight: '10px' }}
        >
          Connect
        </button>
        <button 
          onClick={handleDisconnect} 
          disabled={!isConnected}
        >
          Disconnect
        </button>
        <span style={{ marginLeft: '10px' }}>
          Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: '10px' }}>
          Error: {error}
        </div>
      )}

      {isConnected && (
        <div>
          {toolbox && <div>✅ Toolbox loaded with {Object.keys(toolbox).length} items</div>}
          {flow && <div>✅ Flow loaded</div>}
        </div>
      )}
    </div>
  );
}