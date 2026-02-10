import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Readable } from "stream"; // Import Readable

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

// 1. Generate the sound effect
const result = await client.textToSoundEffects.convert({
  text: "Wooden door closing",
  // duration_seconds: undefined, // Optional: auto-detect
  // prompt_influence: undefined  // Optional: default is 0.3
  // loop: false, // Whether to create a sound effect that loops smoothly
});

// 2. Handle the file writing (Universal Fix)
const fileName = "sound_effect.mp3";
// It returned a Web Stream (Node 18+ / Native Fetch)
// We convert the Web Stream to a Node Stream
// @ts-ignore: TypeScript might complain about types, but this works in Node 22
const nodeStream = Readable.fromWeb(result);
const fileStream = fs.createWriteStream(fileName);

nodeStream.pipe(fileStream);

fileStream.on('finish', () => {
    console.log(`Web Stream saved to ${fileName}`);
});