import { useEffect, useState } from "react";
import type { IFlowModel, IFlowUpdate, IToolboxModel } from "../interfaces/IFlow";
import { usePiApi } from "../custom-communication/PIApi";
import { Subscriptions } from "../custom-communication/PiNotifications";

export const DataViewer = () : JSX.Element => {
  const piApi = usePiApi();
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbox, setToolbox] = useState<IToolboxModel | null>(null);
  const [flow, setFlow] = useState<IFlowModel | null>(null);
  const [subscriptionInternalId, setSubscriptionInternalId] = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState<number>(0);
  
  useEffect(() => {
    if (!piApi) return;

    // Setup connection callbacks
    piApi.onConnected = () => {
      setIsConnected(true);
      setError(null);
    };

    piApi.onConnectionError = (err) => {
      setError(err.message);
      setIsConnected(false);
    };

    piApi.onDisconnected = () => {
      setIsConnected(false);
      setToolbox(null);
      setFlow(null);
      setSubscriptionInternalId(null);
      setNotificationCount(0);
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

  const handleGetToolbox = async () => {
    if (!piApi || !isConnected) return;
    try {
      setError(null);
      const toolboxData = await piApi.getToolbox();
      setToolbox(toolboxData);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get toolbox';
      setError(errorMsg);
    }
  };

  const handleGetFlow = async () => {
    if (!piApi || !isConnected) return;
    try {
      setError(null);
      const flowData = await piApi.getFlow();
      setFlow(flowData);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get flow';
      setError(errorMsg);
    }
  };

  const handleSubscribeToFlow = async () => {
    if (!piApi || !isConnected) return;
    try {
      setError(null);
      
      // Create subscription with callback and error handler
      const subscription = Subscriptions.FlowSubscription(
        (data: IFlowUpdate) => {
          console.log('DataViewer: Received flow notification:', data);
          setNotificationCount(prev => prev + 1);
          // TODO: Apply incremental updates to flow state
          // data.addedModules, data.changedModules, data.removedModules, etc.
        },
        (error: Error) => {
          console.error('DataViewer: Subscription error:', error);
          setError(error.message);
        }
      );
      
      // Subscribe and get internal ID
      const internalId = await piApi.subscribe(subscription, {});
      setSubscriptionInternalId(internalId);
      
      console.log(`DataViewer: Subscribed with internalId: ${internalId}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to subscribe to flow';
      setError(errorMsg);
    }
  };

  const handleUnsubscribeFromFlow = () => {
    if (!piApi || !subscriptionInternalId) return;
    piApi.unsubscribe(subscriptionInternalId);
    setSubscriptionInternalId(null);
    setNotificationCount(0);
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
          style={{ marginRight: '10px' }}
        >
          Disconnect
        </button>
        <span style={{ marginLeft: '10px' }}>
          Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      {isConnected && (
        <div style={{ marginBottom: '20px' }}>
          <button 
            onClick={handleGetToolbox} 
            disabled={!isConnected}
            style={{ marginRight: '10px' }}
          >
            Get Toolbox
          </button>
          <button 
            onClick={handleGetFlow} 
            disabled={!isConnected}
            style={{ marginRight: '10px' }}
          >
            Get Flow
          </button>
          <button 
            onClick={handleSubscribeToFlow} 
            disabled={!isConnected || !!subscriptionInternalId}
            style={{ marginRight: '10px' }}
          >
            Subscribe to Flow
          </button>
          <button 
            onClick={handleUnsubscribeFromFlow} 
            disabled={!subscriptionInternalId}
            style={{ marginRight: '10px' }}
          >
            Unsubscribe from Flow
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', marginBottom: '10px' }}>
          Error: {error}
        </div>
      )}

      {isConnected && (
        <div>
          {toolbox && <div>✅ Toolbox loaded with {Object.keys(toolbox).length} items</div>}
          {flow && <div>✅ Flow loaded</div>}
          {subscriptionInternalId && (
            <div>
              ✅ Flow subscription active (ID: {subscriptionInternalId})
              <br />
              📬 Notifications received: {notificationCount}
            </div>
          )}
        </div>
      )}
    </div>
  );
}