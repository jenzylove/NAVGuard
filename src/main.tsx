import { Buffer } from "buffer";
import "./styles.css";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

void import("./render");
