const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSecrets } = require("./secrets");
require("dotenv").config();

let ai;
let model;

const initialiseGemini = async () => {
  // Initialize the GoogleGenerativeAI client
  const { geminiApiKey } = getSecrets();
  ai = new GoogleGenerativeAI(geminiApiKey);

  // Get the model instance for gemini-1.5-flash
  model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
};

initialiseGemini();
// Export the components
module.exports = {
  initialiseGemini,
};
