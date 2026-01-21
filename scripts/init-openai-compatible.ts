import path from "path";
import * as fs from "fs";

const CONFIG_TEMPLATE = `
import { type OpenAICompatibleProvider } from "./src/lib/ai/create-openai-compatible";

const providers: OpenAICompatibleProvider[] = [];

export default providers;
`.trim();

const ROOT = process.cwd();
const FILE_NAME = "openai-compatible.config.ts";
const CONFIG_PATH = path.join(ROOT, FILE_NAME);

function createConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    try {
      fs.writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE, "utf-8");
      console.log(`${FILE_NAME} file has been created.`);
    } catch (error) {
      console.error(`Error occurred while creating ${FILE_NAME} file.`);
      console.error(error);
      return false;
    }
  } else {
    console.info(`${FILE_NAME} file already exists. Skipping...`);
  }
}

createConfigFile();
