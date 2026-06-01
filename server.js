import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("SafeMeds API running");
});

/* =========================
   HELPERS
========================= */

// Normalize drug name → RxNorm
async function getRxNorm(drug) {
  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(drug)}`
    );

    const data = await res.json();

    return data?.drugGroup?.conceptGroup
      ?.find(g => g.conceptProperties)
      ?.conceptProperties?.[0] || null;

  } catch {
    return null;
  }
}

// FDA label info
async function getFDA(drug) {
  try {
    const res = await fetch(
      `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${drug}"&limit=1`
    );

    if (!res.ok) return null;

    const data = await res.json();
    return data?.results?.[0] || null;

  } catch {
    return null;
  }
}

// Drug interactions
async function getInteractions(rxcui) {
  try {
    const res = await fetch(
      `https://rxnav.nlm.nih.gov/REST/interaction/interaction.json?rxcui=${rxcui}`
    );

    const data = await res.json();

    return data?.fullInteractionTypeGroup?.[0]
      ?.fullInteractionType || null;

  } catch {
    return null;
  }
}

// PubMed research count
async function getPubMedCount(drug) {
  try {
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(drug)}&retmode=json`
    );

    const data = await res.json();

    return data?.esearchresult?.count || "0";

  } catch {
    return "0";
  }
}

/* =========================
   MAIN ROUTE
========================= */

app.post("/drug", async (req, res) => {

  const query = req.body.query;

  if (!query) {
    return res.json({
      answer: "Please enter a medication name."
    });
  }

  try {

    /* STEP 1: RXNORM */
    const rx = await getRxNorm(query);

    if (!rx) {
      return res.json({
        answer: "Medication not found. Try a generic or brand name (e.g., ibuprofen, Tylenol)."
      });
    }

    const drugName = rx.name;
    const rxcui = rx.rxcui;

    /* STEP 2: FDA DATA */
    const fda = await getFDA(drugName);

    /* STEP 3: INTERACTIONS */
    const interactions = await getInteractions(rxcui);

    let interactionText = "No interaction data found.";

    try {
      const first =
        interactions?.[0]
          ?.interactionPair?.[0]
          ?.description;

      if (first) {
        interactionText = first.slice(0, 500);
      }
    } catch {}

    /* STEP 4: PUBMED */
    const pubmedCount = await getPubMedCount(drugName);

    /* =========================
       RESPONSE
    ========================= */

    const answer = `
⚕️ SAFE MEDS INFORMATION (NOT MEDICAL ADVICE)

Drug: ${drugName}
RxCUI: ${rxcui}

--- USES ---
${fda?.indications_and_usage?.[0]?.slice(0, 500) || "Not available"}

--- WARNINGS ---
${fda?.warnings?.[0]?.slice(0, 500) || "Not available"}

--- SIDE EFFECTS ---
${fda?.adverse_reactions?.[0]?.slice(0, 500) || "Not available"}

--- INTERACTIONS ---
${interactionText}

--- RESEARCH ---
${pubmedCount} PubMed studies indexed

--- SOURCES ---
RxNorm | openFDA | RxNav | PubMed
`;

    return res.json({ answer });

  } catch (err) {

    console.error(err);

    return res.json({
      answer: "Server error retrieving medication data."
    });
  }
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SafeMeds running on port ${PORT}`);
})
