import { useEffect } from "react";
import type { IFlowModel, IToolboxModel } from "../interfaces/IFlow";
import { usePiApi } from "../custom-communication/PiApi";

// TODO: AI: Multiple performance and correctness issues in this component:
// 1. Deep promise chain (pyramid of doom) instead of async/await - hard to read and maintain
// 2. Missing error handling for getToolbox() - only getFlow() has .catch()
// 3. useEffect runs on every piApi change, but piApi should be stable - unnecessary effect triggers
// 4. No cleanup - if component unmounts during async operations, setState on unmounted component warning
// 5. No loading/error state management
// 6. Multiple console.log statements that should be removed for production
// FIX: Use async/await, proper error handling, AbortController for cleanup, and loading states
export const DataViewer = () : JSX.Element => {

 const piApi = usePiApi();
  
  useEffect(() => {
    // Only try to connect when piApi is available
    if (piApi) {
      // TODO: AI: Replace promise chain with async/await for better readability and error handling
      // TODO: AI: Add AbortController for cleanup when component unmounts
      piApi.connect().then(() => {
        // TODO: AI: Remove console.log from production code
        console.log('DataViewer connected');
        // TODO: AI: This call has NO error handling - if it fails, error is swallowed silently
        piApi.getToolbox().then((toolbox: IToolboxModel) => {
          // TODO: AI: Remove console.log from production code
          console.log('DataViewer received toolbox:', toolbox); 
        })
        // TODO: AI: These nested promises should be combined with Promise.all() or sequential async/await
        piApi.getFlow().then((flow: IFlowModel) => {
                            // TODO: AI: Remove console.log from production code
                            console.log('DataViewer received flow:', flow); 
                        }).catch((error) => {
                            // TODO: AI: This only catches getFlow errors, not getToolbox errors!
                            // TODO: AI: Remove console.error, use proper error reporting
                            console.error('DataViewer failed to get flow:', error);
                        });
        }).catch((error) => {
          // TODO: AI: Remove console.error from production code
          console.error('DataViewer connection failed:', error);
        }
      );
    }    
  }, [piApi]); // Run when piApi becomes available

  // Handle loading state while piApi is initializing
  if (!piApi) {
    return <div>Loading PIApi...</div>;
  }

  // TODO: AI: No loading state while connecting or fetching data - users see "Data Viewer Component" 
  // immediately even though data is still loading. Should show loading indicators.
  return <div>Data Viewer Component</div>;
}