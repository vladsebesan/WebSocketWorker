import { useEffect } from "react";
import { usePIApi } from "../custom-communication/PIApi";
import type { IFlowModel } from "../interfaces/IFlow";

export const DataViewer = () : JSX.Element => {

 const piApi = usePIApi();
  
  useEffect(() => {
    // Only try to connect when piApi is available
    if (piApi) {
      piApi.connect().then(() => {
        console.log('DataViewer connected');

        piApi.getToolbox().then((toolbox: IFlowModel) => {
          console.log('DataViewer received toolbox:', toolbox); 
        }).catch((error) => {
          console.error('DataViewer failed to get toolbox:', error);
        });

      }).catch((error) => {
        console.error('DataViewer connection failed:', error);
      })
    }
  }, [piApi]); // Run when piApi becomes available

  // Handle loading state while piApi is initializing
  if (!piApi) {
    return <div>Loading PIApi...</div>;
  }

  return <div>Data Viewer Component</div>;
}