import ReactDOM from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "./App";
import "./styles.css";
import "./experience.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// The native command returns null in ordinary application sessions.
import { captureReadme } from "./readmeCapture";
void captureReadme();
