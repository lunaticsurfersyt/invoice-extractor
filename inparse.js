// --- Dependencies ---
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdf = require("pdf-parse");
const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");

// --- Express App Setup ---
const app = express();
app.use(cors()); // enable cross-origin requests
const PORT = process.env.PORT || 3000;

// --- Serve index.html ---
app.use(express.static(path.join(__dirname))); 

// --- Multer Configuration ---
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === "application/pdf" ||
            file.mimetype === "image/jpeg" ||
            file.mimetype === "image/png"
        ) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only PDF, JPG, and PNG are allowed."), false);
        }
    }
});

// --- Data Extraction Logic ---
function extractInvoiceData(text) {
    const data = { invoiceNumber: null, date: null, vendor: null, total: null };
    const lines = text.split("\n").filter(line => line.trim() !== "");
    if (lines.length > 0) data.vendor = lines[0].trim();

    let invoiceNumMatch = text.match(/(?:invoice\s?#|invoice\s?no|inv\s?#|invoice\snumber)\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    if (invoiceNumMatch) data.invoiceNumber = invoiceNumMatch[1];

    let dateMatch = text.match(/(?:date|invoice\sdate)\s*[:\-]?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\w+\s\d{1,2},\s\d{4})/i);
    if (dateMatch) data.date = dateMatch[1];

    let totalMatch = text.match(/(?:total|amount\s?due|balance)\s*[:\-]?\s*(?:[\$€£]?\s?)(\d+(?:\.\d{2})?)/i);
    if (totalMatch) {
        data.total = totalMatch[1];
    } else {
        const numbers = text.match(/[\$€£]?\s?\d+\.\d{2}/g) || [];
        const numericValues = numbers.map(n => parseFloat(n.replace(/[^\d.]/g, "")));
        if (numericValues.length > 0) {
            data.total = Math.max(...numericValues).toFixed(2);
        }
    }
    return data;
}

// --- API Endpoint ---
app.post("/upload", upload.single("invoice"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    let rawText = "";

    try {
        if (req.file.mimetype === "application/pdf") {
            console.log("Processing PDF...");
            const data = await pdf(req.file.buffer);
            rawText = data.text;
        } else {
            console.log("Processing Image...");
            const worker = await createWorker("eng");
            const { data: { text } } = await worker.recognize(req.file.buffer);
            rawText = text;
            await worker.terminate();
        }

        if (!rawText) return res.status(500).json({ error: "Could not extract text from file." });

        const extractedData = extractInvoiceData(rawText);
        console.log("Extraction complete.");
        res.status(200).json(extractedData);

    } catch (error) {
        console.error("Error processing file:", error);
        res.status(500).json({ error: "An error occurred while processing the file." });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`✅ Invoice parser MVP running at http://localhost:${PORT}`);
    console.log("📤 Send a POST request to /upload with a file attached (form-data key: 'invoice').");
});
