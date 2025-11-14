import { useEffect } from "react";
import type { IFlowModel, IToolboxModel } from "../interfaces/IFlow";
import { usePiApi } from "../custom-communication/PiApi";

export const DataViewer = () : JSX.Element => {

 const piApi = usePiApi();
  
  useEffect(() => {
    // Only try to connect when piApi is available
    if (piApi) {
      piApi.connect().then(() => {
        console.log('DataViewer connected');
        piApi.getToolbox().then((toolbox: IToolboxModel) => {
          console.log('DataViewer received toolbox:', toolbox); 
        })
        piApi.getFlow().then((flow: IFlowModel) => {
                            console.log('DataViewer received flow:', flow); 
                        }).catch((error) => {
                            console.error('DataViewer failed to get flow:', error);
                        });
        }).catch((error) => {
          console.error('DataViewer connection failed:', error);
        }
      );
    }    
  }, [piApi]); // Run when piApi becomes available

  // Handle loading state while piApi is initializing
  if (!piApi) {
    return <div>Loading PIApi...</div>;
  }

  return <div>Data Viewer Component</div>;
}