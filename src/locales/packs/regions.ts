import type { AtsRegionPackInput } from "../schema.js";

/**
 * Region packs: what differs by country rather than by language — how a national phone number
 * and an all-numeric date are written, the credentials of the national education system, and
 * the conventions a recruiter there holds a resume to.
 *
 * Credentials live here, not in the language packs, because an English resume carries them too:
 * "Abitur" from Germany, "Class XII" and "B.Com" from India.
 *
 * The rule adjustments name rules of the community policy. A date of birth or a photo is
 * expected in Germany and India and a liability in the US, where it invites age and appearance
 * bias; `weight: 0` turns the rule off for the region rather than passing it.
 */
const word = (body: string) => String.raw`(?<![\p{L}\p{M}])(?:${body})(?![\p{L}\p{M}])`;

/**
 * "LLM" undotted, as the default policy reads it: a Master of Laws only where a degree stands and
 * with a law school or university on the line; otherwise a large language model.
 */
const LAW = String.raw`(?<!\p{L})(?:laws?|universit(?:y|ies)|college|school|faculty)(?!\p{L})`;
const LLM = String.raw`llm(?=\s*[,()]|\s+in\s|\s+(?:19|20)\d{2}(?!\d)|\s*$)(?:(?=[^\n]{0,80}?${LAW})|(?<=${LAW}[^\n]{0,80}llm))`;

export const US: AtsRegionPackInput = {
  id: "US",
  name: "United States",
  status: "verified",
  maintainers: [],
  phoneCountry: "US",
  dateOrder: "MDY",
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 6, severity: "warning" },
    "ats-v2.format.photo": { weight: 6, severity: "warning" },
  },
};

export const DE: AtsRegionPackInput = {
  id: "DE",
  name: "Deutschland",
  status: "community",
  maintainers: [],
  phoneCountry: "DE",
  dateOrder: "DMY",
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  degrees: {
    "2": word(String.raw`mittlere\s+reife|realschulabschluss|hauptschulabschluss`),
    "3": word(
      String.raw`abitur|fachabitur|(?:allgemeine\s+|fachgebundene\s+)?hochschulreife|fachhochschulreife|(?:abgeschlossene\s+)?berufsausbildung|ausbildung\s+(?:zum|zur|als)|gesellen(?:brief|prüfung)`,
    ),
    // Diplom (FH) is a bachelor's equivalent, as is a Diplom (BA) from a Berufsakademie, and so,
    // at DQR level 6, are a master craftsman (Meister, alone or compounded:
    // "Elektrotechnikermeister") and a state-certified technician or business economist
    // ("Staatlich geprüfter Techniker"). The compound prefix is bounded to stay linear, and skips
    // the Meister who hold no credential: caretaker, mayor, champion.
    "6": word(
      String.raw`dipl(?:om|\.)(?:-\p{L}+)?\.?\s*\((?:fh|ba)\)|\p{L}{0,30}(?<!haus|bürger|welt|europa|bundes|landes|kreis|stadt|vereins|kapell|konzert|ballett|schach)meister(?:in|prüfung|brief|titel)?|staatl(?:ich|\.)\s*gepr(?:üfte[nr]?|\.)\s+\p{L}+`,
    ),
    // The lookahead pair keeps "Diplom-Informatiker (FH)" or "(BA)" from backtracking into a match
    // here; its optional dot keeps "Dipl.-Ing. (FH)" from matching as "Dipl.-Ing" before the dot.
    "7": word(
      String.raw`dipl(?:om|\.)(?:-\p{L}+)?\.?(?![\p{L}-])(?!\.?\s*\((?:fh|ba)\))|magister|staatsexamen`,
    ),
    "8": word(
      String.raw`promotion\s+(?:zum|zur|in)|promoviert|doktorarbeit|doktorgrad|dr\.[\s-]?(?:rer|phil|ing|med)\.`,
    ),
  },
};

export const IN: AtsRegionPackInput = {
  id: "IN",
  name: "India",
  status: "community",
  maintainers: [],
  phoneCountry: "IN",
  dateOrder: "DMY",
  // State and union territory codes written after a city ("Pune, MH"): a place, never a name.
  regionCodes: [
    "AP",
    "AR",
    "AS",
    "BR",
    "CG",
    "DL",
    "GA",
    "GJ",
    "HP",
    "HR",
    "JH",
    "JK",
    "KA",
    "KL",
    "LA",
    "MH",
    "ML",
    "MN",
    "MP",
    "MZ",
    "NL",
    "OD",
    "PB",
    "PY",
    "RJ",
    "SK",
    "TN",
    "TR",
    "TS",
    "UK",
    "UP",
    "WB",
  ],
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  // Institutions named in transliterated Hindi: "Kendriya Vidyalaya", "Jamia ... Vishwavidyalaya".
  schoolWords: ["vidyalaya", "mahavidyalaya", "vishwavidyalaya", "vidyapeeth", "vidyapith"],
  degrees: {
    // The Secondary School Certificate (SSC), and the Secondary School Leaving Certificate
    // (SSLC) of Karnataka and Kerala, are the Class X board exam, not school-leaving; the
    // pre-university course (PUC, "II PUC") is Class XII. "BE" undotted is the English verb
    // unless a branch of engineering or a bracket follows; "LLM" undotted is a language model
    // unless it stands where a degree does beside a law school (see `LLM` above).
    "2": word(
      String.raw`class\s+(?:x|10)(?:th)?|10th(?:\s+(?:standard|grade|class))?|matriculation|s\.?s\.?l\.?c\.?|s\.?s\.?c\.?|secondary\s+school\s+certificate`,
    ),
    "3": word(
      String.raw`class\s+(?:xii|12)(?:th)?|12th(?:\s+(?:standard|grade|class))?|h\.?s\.?c\.?|intermediate\s+(?:\(|board|education|exam)|higher\s+secondary|senior\s+secondary|pre[\s-]university|(?:ii\s+|2nd\s+)?p\.?u\.?c\.?`,
    ),
    "6": word(
      String.raw`b\.?\s?com\.?|b\.?c\.?a\.?|b\.?b\.?a\.?|b\.\s?e\.?|be(?=\s*\(|\s+(?:in\s+)?(?:mechanical|civil|electrical|electronics|computer|chemical|information|production|instrumentation|aeronautical|automobile|biomedical|biotechnology|mechatronics|industrial|metallurgy|textile|marine|aerospace)(?![\p{L}\p{M}]))|b\.?\s?pharm\.?|ll\.?b\.?`,
    ),
    "7": word(
      String.raw`m\.?\s?com\.?|m\.?c\.?a\.?|m\.\s?e\.?|pgdm|pgdba|post[\s-]?graduate\s+diploma|m\.?b\.?b\.?s\.?|ll\.m\.?|${LLM}`,
    ),
  },
};
