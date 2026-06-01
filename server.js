import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("SafeMeds API running (production version)");
});

/* =========================
   INTENT DETECTION
========================= */
function detectIntent(text = "") {
  const input = text.toLowerCase().trim();

  const chatNoise = [
    "hi","hello","hey","help","thanks","thank you",
    "what can you do","who are you","good morning","good evening"
  ];

  if (chatNoise.includes(input)) {
    return { type: "help" };
  }

  if (input.length < 3 || !/[a-z]/i.test(input)) {
    return { type: "invalid" };
  }

  return { type: "drug" };
}

/* =========================
   DRUG CLEANING
========================= */
function cleanDrugName(raw = "") {
  return raw
    .replace(/\[.*?\]/g, "")
    .replace(/\d+(\.\d+)?\s*mg/gi, "")
    .replace(/\b(extended release|er|tablet|capsule|oral|solution)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitDrugs(name = "") {
  return name
    .split(/\/|,/)
    .map(cleanDrugName)
    .filter(Boolean);
}

/* =========================
   HELP MESSAGE
========================= */
function getHelpMessage() {
  return {
    type: "help",
    message: `
👋 SafeMeds AI Assistant

I can analyze prescription medications using FDA + NIH databases.

✔ Try typing a medication name:
- metformin
- ibuprofen
- lisinopril
- Adderall
- Kombiglyze XR

❌ I cannot process general chat messages.

Please enter a drug name to continue.
    `
  };
}

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
   FDA LABEL
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
   FAERS
========================= */
async function getFAERS(drug) {
  try {
    const res = await fetch(
      `https://api.fda.gov/drug/event.json?search=patient.drug.medicinalproduct:"${drug}"&limit=10`
    );

    if (!res.ok) return [];

    const data = await res.json();
    return data?.results || [];

  } catch {
    return [];
  }
}

function parseFAERS(data = []) {
  const reactions = data
    .flatMap(r => r?.patient?.reaction || [])
    .map(r => r?.reactionmeddrapt)
    .filter(Boolean);

  const counts = {};

  reactions.forEach(r => {
    counts[r] = (counts[r] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${name} (${count})`);
}

/* =========================
   INTERACTIONS
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
   PUBMED
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
   RISK SCORE
========================= */
function calculateRisk(fda = "", faers = "") {
  let score = 0;

  const text = (fda + " " + faers).toLowerCase();

  const redFlags = [
    "death", "fatal", "cardiac arrest",
    "liver failure", "respiratory failure",
    "black box warning"
  ];

  redFlags.forEach(w => {
    if (text.includes(w)) score += 2;
  });

  if (score >= 4) return "HIGH";
  if (score >= 2) return "MODERATE";
  return "LOW";
}

/* =========================
   MAIN ROUTE
========================= */
app.post("/drug", async (req, res) => {

  const query = req.body.query;

  if (!query) {
    return res.json(getHelpMessage());
  }

  const intent = detectIntent(query);

  if (intent.type !== "drug") {
    return res.json(getHelpMessage());
  }

  try {

    /* STEP 1: RXNORM */
    const rx = await getRxNorm(query);

    const rawName = rx?.name || query;
    const drugs = splitDrugs(rawName);
    const primaryDrug = drugs[0];

    if (!primaryDrug) {
      return res.json({
        type: "error",
        message: "Please enter a valid medication name."
      });
    }

    /* STEP 2: DATA SOURCES */
    const fda = await getFDA(primaryDrug);
    const faers = await getFAERS(primaryDrug);
    const interactions = await getInteractions(rx?.rxcui);
    const pubmedCount = await getPubMedCount(primaryDrug);

    /* STEP 3: INTERACTIONS TEXT */
    let interactionText = "No interaction data available.";

    try {
      const desc = interactions?.[0]?.interactionPair?.[0]?.description;
      if (desc) interactionText = desc.slice(0, 500);
    } catch {}

    /* STEP 4: FAERS TEXT */
    const faersText =
      faers.length > 0
        ? parseFAERS(faers).join(", ")
        : "No FAERS reports found.";

    /* STEP 5: RISK */
    const risk = calculateRisk(
      fda?.warnings?.[0] || "",
      faersText
    );

    /* FINAL RESPONSE */
    return res.json({
      type: "drug_info",
      data: {
        drug: primaryDrug,
        rxcui: rx?.rxcui || null,

        fda_indications: fda?.indications_and_usage?.[0] || null,
        warnings: fda?.warnings?.[0] || null,
        side_effects: fda?.adverse_reactions?.[0] || null,

        interactions: interactionText,
        faers: faersText,

        pubmed_count: pubmedCount,
        risk_level: risk
      }
    });

  } catch (err) {

    console.error(err);

    return res.json({
      type: "error",
      message: "Error retrieving medication data."
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
