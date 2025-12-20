// src/config/gemini.js
const API_KEY = "AIzaSyAHrKwpZ5hgJvZOHz5qYG7_0zAkWd7lq7w";
// const MODEL_NAME = "gemini-2.0-flash";
const MODEL_NAME = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

module.exports = { GEMINI_URL };