import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("SafeMeds API running with FAERS integration");
});

/* =========================
   RXNORM
========================= */
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

/* =========================
   OPENFDA LABEL
========================= */
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

/* =========================
   RXNAV INTERACTIONS
========================= */
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

/* =========================
   ⭐ FAERS (SIMPLIFIED & SAFE)
========================= */
async function getFAERS(drug) {
  try {
    const url =
      `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:"${drug}"&limit=10`;

    const res = await fetch(url);

    if (!res.ok) return [];

    const data = await res.json();

    return data?.results || [];

  } catch {
    return [];
  }
}

/* =========================
   PUBMED COUNT
========================= */
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
   MAIN ENDPOINT
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
        answer: "Medication not found. Try a generic or brand name."
      });
    }

    const drugName = rx.name;
    const rxcui = rx.rxcui;

    /* STEP 2: FDA */
    const fda = await getFDA(drugName);

    /* STEP 3: INTERACTIONS */
    const interactions = await getInteractions(rxcui);

    let interactionText = "No interaction data available.";

    try {
      const desc =
        interactions?.[0]
          ?.interactionPair?.[0]
          ?.description;

      if (desc) interactionText = desc.slice(0, 500);

    } catch {}

    /* =========================
       ⭐ FAERS PROCESSING (FIXED)
    ========================= */
    const faers = await getFAERS(drugName);

    let faersText = "No FAERS reports available.";

    if (faers.length > 0) {

      const reactions = faers
        .flatMap(r => r?.patient?.reaction || [])
        .map(r => r?.reactionmeddrapt)
        .filter(Boolean);

      const unique = [...new Set(reactions)].slice(0, 8);

      faersText =
        unique.length > 0
          ? `Reported adverse events: ${unique.join(", ")}`
          : "FAERS data exists but no readable event names found.";
    }

    /* STEP 4: PUBMED */
    const pubmedCount = await getPubMedCount(drugName);

    /* =========================
       RESPONSE
    ========================= */

    const answer = `
⚕️ SAFE MEDS (INFORMATION ONLY — NOT MEDICAL ADVICE)

Drug: ${drugName}
RxCUI: ${rxcui}

--- FDA INDICATIONS ---
${fda?.indications_and_usage?.[0]?.slice(0, 500) || "Not available"}

--- WARNINGS ---
${fda?.warnings?.[0]?.slice(0, 500) || "Not available"}

--- COMMON SIDE EFFECTS ---
${fda?.adverse_reactions?.[0]?.slice(0, 500) || "Not available"}

--- ⚠️ REAL-WORLD REPORTS (FAERS) ---
${faersText}

--- DRUG INTERACTIONS ---
${interactionText}

--- RESEARCH ---
${pubmedCount} PubMed studies indexed

--- SOURCES ---
RxNorm | openFDA | RxNav | FAERS | PubMed
`;

    return res.json({ answer });

  } catch (err) {

    console.error(err);

    return res.json({
      answer: "Error retrieving medication data."
    });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SafeMeds API running on port ${PORT}`);
});
