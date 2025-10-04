const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

// Initialize the GoogleGenerativeAI client
const ai = new GoogleGenerativeAI("AIzaSyCAS3oExzRm1f9yVYFKHuLzNRdedXTNAZA");

// Get the model instance for gemini-1.5-flash
const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

// Export the components
module.exports = {
  ai,
  model,
};
