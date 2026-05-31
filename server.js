import express from "express";
import cors from "cors";

const app = express();

// REQUIRED for Squarespace frontend requests
app.use(cors());
app.use(express.json());

// Health check route (test in browser)
app.get("/", (req, res) => {
  res.send("Drug API is running");
});

// MAIN DRUG ENDPOINT
app.post("/drug", async (req, res) => {
  const query = req.body.query;

  if (!query) {
    return res.json({
      answer: "No drug query provided."
    });
  }

  try {
    // -----------------------------
    // 1. openFDA lookup (basic label search)
    // -----------------------------
    const fdaUrl = `https://api.fda.gov/drug/label.json?search=generic_name:"${query}"&limit=1`;

    const fdaRes = await fetch(fdaUrl);
    const fdaData = await fdaRes.json();

    if (fdaData.results && fdaData.results.length > 0) {
      const drug = fdaData.results[0];

      return res.json({
        answer: `
DRUG INFORMATION (FDA SOURCE)

Name: ${drug.openfda?.brand_name?.[0] || query}

Indications:
${drug.indications_and_usage?.[0]?.slice(0, 400) || "Not available"}

Warnings:
${drug.warnings?.[0]?.slice(0, 400) || "Not available"}

Side Effects:
${drug.adverse_reactions?.[0]?.slice(0, 400) || "Not available"}

Source: openFDA
        `
      });
    }

    // -----------------------------
    // 2. RxNorm fallback lookup
    // -----------------------------
    const rxUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`;

    const rxRes = await fetch(rxUrl);
    const rxData = await rxRes.json();

    const concept =
      rxData?.drugGroup?.conceptGroup?.find(g => g.conceptProperties)
        ?.conceptProperties?.[0];

    if (concept) {
      return res.json({
        answer: `
DRUG FOUND (NIH RXNORM)

Name: ${concept.name}
RxCUI: ${concept.rxcui}

Source: National Library of Medicine
        `
      });
    }

    // -----------------------------
    // 3. No match found
    // -----------------------------
    return res.json({
      answer: `
No matching drug found.

Try:
- Generic name (ibuprofen)
- Brand name (Advil, Tylenol, Metformin)
      `
    });

  } catch (error) {
    return res.json({
      answer: "Error accessing drug databases. Please try again later."
    });
  }
});

// Start server (Render sets PORT automatically)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Drug API running on port", PORT);
});
