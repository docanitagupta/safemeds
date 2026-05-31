import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Simple health check
app.get("/", (req, res) => {
  res.send("Drug API is running");
});

app.post("/drug", async (req, res) => {
  const query = req.body.query;

  if (!query) {
    return res.json({ answer: "No query provided." });
  }

  try {
    // -----------------------------
    // 1. Try openFDA drug label API
    // -----------------------------
    const fdaUrl = `https://api.fda.gov/drug/label.json?search=generic_name:"${query}"&limit=1`;

    const fdaRes = await fetch(fdaUrl);
    const fdaData = await fdaRes.json();

    if (fdaData.results && fdaData.results.length > 0) {
      const drug = fdaData.results[0];

      return res.json({
        answer: `
Drug Information (FDA Source)

Name: ${drug.openfda?.brand_name?.[0] || query}

Indications:
${drug.indications_and_usage?.[0]?.slice(0, 500) || "Not available"}

Warnings:
${drug.warnings?.[0]?.slice(0, 500) || "Not available"}

Side Effects:
${drug.adverse_reactions?.[0]?.slice(0, 500) || "Not available"}

Source: openFDA
        `
      });
    }

    // -----------------------------
    // 2. Fallback: RxNorm lookup
    // -----------------------------
    const rxUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`;

    const rxRes = await fetch(rxUrl);
    const rxData = await rxRes.json();

    const concept =
      rxData?.drugGroup?.conceptGroup?.find(g => g.conceptProperties)?.conceptProperties?.[0];

    if (concept) {
      return res.json({
        answer: `
Drug Found (NIH RxNorm)

Name: ${concept.name}
RxCUI: ${concept.rxcui}

This is a standardized drug reference entry.

Source: NIH RxNorm
        `
      });
    }

    // -----------------------------
    // 3. No match found
    // -----------------------------
    return res.json({
      answer: `
No matching drug found in FDA or NIH databases.

Try:
- Generic name (ibuprofen)
- Brand name (Advil, Tylenol)
      `
    });

  } catch (error) {
    return res.json({
      answer: "Error accessing drug databases. Please try again later."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Drug API running on port ${PORT}`);
});
