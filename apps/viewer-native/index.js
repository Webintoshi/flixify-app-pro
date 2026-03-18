import { AppRegistry } from "react-native";
import { ViewerNativeApp } from "./src/ViewerNativeApp";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => ViewerNativeApp);
