import { wholeWord as word } from "../../text/text.js";
import { deepFreeze } from "../../util/memo.js";
import type { AtsRegionPackInput } from "../schema.js";

/**
 * Region packs: what differs by country rather than by language: phone and date formats, the
 * credentials of the national education system, and the conventions recruiters there hold a
 * resume to. Credentials live here because an English resume carries them too ("Abitur",
 * "Class XII").
 *
 * Rule adjustments name rules of the community policy: a date of birth or a photo is expected in
 * Germany and India and a liability in the US; `weight: 0` turns the rule off for the region.
 * Only the US pack turns on `ageAdvice`, since advising to hide a graduation year would contradict
 * the convention elsewhere.
 */

/**
 * "LLM" undotted, as the default policy reads it: a Master of Laws only where a degree stands and
 * with a law school or university on the line; otherwise a large language model.
 */
const LAW = String.raw`(?<!\p{L})(?:laws?|universit(?:y|ies)|college|school|faculty)(?!\p{L})`;
const LLM = String.raw`llm(?=\s*[,()]|\s+in\s|\s+(?:19|20)\d{2}(?!\d)|\s*$)(?:(?=[^\n]{0,80}?${LAW})|(?<=${LAW}[^\n]{0,80}llm))`;

/** The United States: month-first dates; a date of birth or a photo is a warning; age advice on. */
export const US: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "US",
  name: "United States",
  status: "verified",
  maintainers: [],
  phoneCountry: "US",
  dateOrder: "MDY",
  cityNames:
    "New York|New York City|NYC|Los Angeles|Chicago|Houston|San Francisco|Seattle|Boston|Austin|Denver|Atlanta|Dallas|Philadelphia|San Diego|San Jose|Miami|Minneapolis|Detroit|Pittsburgh|Nashville|Raleigh|Salt Lake City|Las Vegas|Baltimore|St\\.? Louis|Kansas City|Indianapolis|Sacramento|Orlando|Tampa|Cincinnati|Cleveland|Milwaukee|New Orleans|Brooklyn|Manhattan|Palo Alto|Mountain View|Sunnyvale|Cupertino|Menlo Park|Redmond|Bellevue|Silicon Valley|Bay Area".split(
      "|",
    ),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 6, severity: "warning" },
    "ats-v2.format.photo": { weight: 6, severity: "warning" },
  },
  // US recruiters expect no age on a resume (the ADEA protects applicants 40 and over).
  ageAdvice: { graduationYears: 20, experienceYears: 20 },
});

/** Germany: day-first dates, German credentials; a date of birth or a photo is not judged. */
export const DE: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "DE",
  name: "Deutschland",
  status: "community",
  maintainers: [],
  phoneCountry: "DE",
  dateOrder: "DMY",
  cityNames:
    "Berlin|Hamburg|München|Köln|Frankfurt am Main|Frankfurt|Stuttgart|Düsseldorf|Leipzig|Dortmund|Bremen|Dresden|Hannover|Nürnberg|Duisburg|Bochum|Wuppertal|Bielefeld|Bonn|Münster|Karlsruhe|Mannheim|Augsburg|Wiesbaden|Mainz|Kiel|Aachen|Freiburg|Freiburg im Breisgau|Heidelberg|Regensburg|Darmstadt|Potsdam|Erlangen|Ingolstadt|Wolfsburg|Walldorf|Braunschweig|Chemnitz|Magdeburg|Rostock|Saarbrücken|Erfurt|Jena|Munich|Cologne|Nuremberg|Hanover|Dusseldorf".split(
      "|",
    ),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  degrees: {
    "2": word(String.raw`mittlere\s+reife|realschulabschluss|hauptschulabschluss`),
    "3": word(
      String.raw`abitur|fachabitur|matura|(?:berufs)?maturit[äa]t|berufsmatura|reifepr[üu]fung|efz|eidg(?:en[öo]ssisches|\.)\s+f[äa]higkeitszeugnis|(?:allgemeine\s+|fachgebundene\s+)?hochschulreife|fachhochschulreife|(?:abgeschlossene\s+)?berufsausbildung|ausbildung\s+(?:zum|zur|als)(?:\s+\p{L}[\p{L}-]{0,40})?|gesellen(?:brief|prüfung)`,
    ),
    // Diplom (FH) and Diplom (BA) are bachelor's equivalents, as at DQR level 6 are a master
    // craftsman (Meister, alone or compounded) and a state-certified technician or business
    // economist. The compound prefix is bounded to stay linear, and skips the Meister who hold no
    // credential: caretaker, mayor, champion.
    "6": word(
      String.raw`dipl(?:om|\.)(?:-\p{L}+)?\.?\s*\(?(?:fh|ba|hf)\)?(?!\p{L})|dipl(?:om|\.)[^\n,;|]{0,60}?\s\(?hf(?!\p{L})|eidg\.\s?dipl\.|eidg(?:en[öo]ssischer|\.)\s+fachausweis|\p{L}{0,30}(?<!haus|bürger|welt|europa|bundes|landes|kreis|stadt|vereins|kapell|konzert|ballett|schach)meister(?:in|prüfung|brief|titel)?|staatl(?:ich|\.)\s*gepr(?:üfte[nr]?|\.)\s+\p{L}+`,
    ),
    // The lookahead pair stops "Diplom-Informatiker (FH)" backtracking into a match here; the
    // optional dot stops "Dipl.-Ing. (FH)" matching as "Dipl.-Ing" before the dot.
    "7": word(
      String.raw`(?<!eidg\.\s?)dipl(?:om|\.)(?:-\p{L}+)?\.?(?![\p{L}-])(?!\.?\s*\(?(?:fh|ba|hf)(?!\p{L}))(?![^\n,;|]{0,60}?\s\(?hf(?!\p{L}))|magister|staatsexamen`,
    ),
    // An English posting's "sales promotion in retail" is no doctorate: German puts none of these
    // words before "Promotion".
    "8": word(
      String.raw`(?<!(?<![\p{L}\p{M}])(?:sales|trade|product|brand|price|retail|store|consumer|marketing|event|career|internal|a|the|for|of|and|or|on|to|your|our)[\s-]{1,3})promotion\s+(?:zum|zur|in|im|an\s+der)|promoviert|doktorarbeit|doktorgrad|dr\.[\s-]?(?:rer|phil|ing|med|jur|iur|oec|sc)\.`,
    ),
  },
});

/** India: day-first dates, Indian credentials and state codes; date of birth and photo not judged. */
export const IN: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "IN",
  name: "India",
  status: "community",
  maintainers: [],
  phoneCountry: "IN",
  dateOrder: "DMY",
  cityNames:
    "Mumbai|Bombay|Delhi|New Delhi|Bengaluru|Bangalore|Hyderabad|Chennai|Madras|Kolkata|Calcutta|Pune|Ahmedabad|Jaipur|Lucknow|Noida|Greater Noida|Gurugram|Gurgaon|Chandigarh|Kochi|Cochin|Coimbatore|Indore|Bhopal|Nagpur|Thiruvananthapuram|Trivandrum|Visakhapatnam|Mysuru|Mysore|Bhubaneswar|Vadodara|Surat|Patna|Mangaluru|Mangalore|Navi Mumbai|Thane|Kanpur|Varanasi|Ghaziabad|Faridabad|Ludhiana|Guwahati|Dehradun|Ranchi|Raipur|Agra|नई दिल्ली|दिल्ली|मुंबई|बेंगलुरु|बैंगलोर|हैदराबाद|चेन्नई|कोलकाता|पुणे|अहमदाबाद|जयपुर|लखनऊ|नोएडा|गुरुग्राम|गुड़गांव|चंडीगढ़|भोपाल|इंदौर|नागपुर|पटना|कानपुर|वाराणसी|सूरत|वडोदरा".split(
      "|",
    ),
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
    "TG",
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
    // unless a branch of engineering or a bracket follows, and always after "must" or "to" ("must
    // be computer literate"); "LLM" undotted is a language model
    // unless it stands where a degree does beside a law school (see `LLM` above).
    "2": word(
      String.raw`class\s+(?:x|10)(?:th)?|10th(?!\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|rank|position|place))(?:\s+(?:standard|grade|class))?|xth|(?:std\.?|standard)\s+(?:x|10)(?:th)?|matric(?:ulation)?|s\.?s\.?l\.?c\.?|s\.?s\.?c\.?|secondary\s+school\s+certificate`,
    ),
    "3": word(
      String.raw`class\s+(?:xii|12)(?:th)?|12th(?!\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|rank|position|place))(?:\s+(?:standard|grade|class))?|xiith|10\s*\+\s*2|(?:std\.?|standard)\s+(?:xii|12)(?:th)?|h\.?s\.?c\.?|intermediate\s+(?:\(|board|education|exam|from|in\s+(?:science|commerce|arts|mpc|bipc))|higher\s+secondary|senior\s+secondary|pre[\s-]university|(?:ii\s+|2nd\s+)?p\.?u\.?c\.?`,
    ),
    "6": word(
      String.raw`b\.?\s?com\.?|b\.?c\.?a\.?|b\.?b\.?a\.?|b\.\s?e\.?|(?<!(?:must|will|would|should|shall|can|could|may|might|to|not|also)\s{1,3})be(?=\s*\(|\s+(?:in\s+)?(?:mechanical|civil|electrical|electronics|computer|chemical|information|production|instrumentation|aeronautical|automobile|biomedical|biotechnology|mechatronics|industrial|metallurgy|textile|marine|aerospace)(?![\p{L}\p{M}]))|b\.?\s?pharm(?:a|acy)?\.?|ll\.?b\.?`,
    ),
    "7": word(
      String.raw`m\.?\s?com\.?|m\.?c\.?a\.?|m\.\s?e\.?|pgdm|pgdba|post[\s-]?graduate\s+diploma|m\.?b\.?b\.?s\.?|m\.?\s?pharm(?:a)?\.?|m\.?\s?phil\.?|ll\.m\.?|${LLM}`,
    ),
  },
});

/** France: day-first dates, French credentials; a date of birth or a photo is not judged, as French CVs carry both. */
export const FR: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "FR",
  name: "France",
  status: "community",
  maintainers: [],
  phoneCountry: "FR",
  dateOrder: "DMY",
  cityNames:
    "Paris|Lyon|Marseille|Toulouse|Nantes|Strasbourg|Montpellier|Bordeaux|Lille|Rennes|Reims|Grenoble|Dijon|Angers|Nîmes|Clermont-Ferrand|Le Mans|Aix-en-Provence|Brest|Amiens|Limoges|Metz|Rouen|Caen|Orléans|Saint-Étienne|Sophia Antipolis|La Défense|Boulogne-Billancourt|Nanterre|Issy-les-Moulineaux|Versailles|Toulon|Mulhouse|Perpignan|Besançon|Poitiers".split(
      "|",
    ),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  // The French system, by years after the baccalauréat: "Bac+2" (BTS, DUT) short-cycle tertiary,
  // "Bac+3" (licence, BUT) bachelor's, "Bac+5" (master, diplôme d'ingénieur) master's, "Bac+8"
  // doctorate. Tried highest first, so "Bac+5" is never read as the baccalauréat. "Bac+N" is in
  // the `fr` pack too. A baccalauréat named for its field is Québec's bachelor's (`fr` pack).
  // "BUT" only before its speciality, since "but" is a French and an English word; the speciality
  // is the field, not the credential.
  degrees: {
    "2": word(
      String.raw`brevet(?:\s+des\s+coll[èe]ges)?(?!\s+(?:de\s+technicien|d['’]|professionnel))|dnb`,
    ),
    "3": word(
      String.raw`baccalaur[ée]at(?!\s+en\s+\p{L})(?:\s+(?:g[ée]n[ée]ral|technologique|professionnel|s|es|l|stmg|sti2d))?|bac(?!\s*\+|\s+en\s+\p{L})(?:\s+(?:g[ée]n[ée]ral|technologique|pro(?:fessionnel)?|s|es|l|stmg|sti2d))?|cap|bep`,
    ),
    "5": word(String.raw`bts|dut|deug|bac\s*\+\s*2|brevet\s+de\s+technicien\s+sup[ée]rieur`),
    "6": word(
      String.raw`b\.u\.t\.|but(?=\s+(?:informatique|gea|tc|mmi|geii|gmp|r&t|rt|qlio|chimie|g[ée]nie\s+\p{L}+|techniques\s+de\s+commercialisation|gestion\s+des\s+entreprises)(?![\p{L}\p{M}]))|bac\s*\+\s*3`,
    ),
    "7": word(String.raw`bac\s*\+\s*5|dea|dess|grande\s+[ée]cole`),
    "8": word(String.raw`bac\s*\+\s*8`),
  },
});

/**
 * The United Kingdom: day-first dates, UK credentials; a date of birth or a photo is a warning
 * (the Equality Act 2010 protects age and appearance). A-levels are the policy's own (level 3);
 * degree classes need nothing.
 */
export const GB: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "GB",
  name: "United Kingdom",
  status: "community",
  maintainers: [],
  phoneCountry: "GB",
  dateOrder: "DMY",
  cityNames:
    "London|Manchester|Birmingham|Leeds|Glasgow|Edinburgh|Liverpool|Bristol|Sheffield|Newcastle|Newcastle upon Tyne|Nottingham|Leicester|Cardiff|Belfast|Southampton|Cambridge|Oxford|Brighton|Aberdeen|Coventry|Milton Keynes|Swansea|Dundee|Canary Wharf".split(
      "|",
    ),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 6, severity: "warning" },
    "ats-v2.format.photo": { weight: 6, severity: "warning" },
  },
  // Wales's further-education colleges are "Coleg".
  schoolWords: ["coleg"],
  degrees: {
    "2": word(String.raw`i?gcses?|o[\s-]levels?`),
    "3": word(String.raw`as[\s-]levels?|(?:advanced\s+)?highers`),
    "5": word(String.raw`hnd|hnc|higher\s+national\s+(?:diploma|certificate)|foundation\s+degree`),
    "7": word(String.raw`pgce|pg\s?dip|postgraduate\s+(?:diploma|certificate)`),
  },
});

/**
 * Spain: day-first dates, Spanish credentials; a date of birth or a photo is customary and not
 * judged. Bachillerato is upper secondary here (in Peru a "bachiller" is a university degree, so
 * it is not the `es` pack's), and a higher vocational cycle is short-cycle tertiary.
 */
export const ES: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "ES",
  name: "España",
  status: "community",
  maintainers: [],
  phoneCountry: "ES",
  dateOrder: "DMY",
  cityNames: (
    "Madrid|Barcelona|Valencia|Sevilla|Zaragoza|Málaga|Malaga|Bilbao|Alicante|Valladolid|Vigo|" +
    "Gijón|A Coruña|La Coruña|Palma de Mallorca|Las Palmas de Gran Canaria|Granada|San Sebastián|" +
    "Donostia|Pamplona|Salamanca|Santander"
  ).split("|"),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  degrees: {
    "2": word(String.raw`eso|graduado\s+en\s+(?:educaci[óo]n\s+)?secundaria`),
    "3": word(
      String.raw`bachillerato|ciclo\s+(?:formativo\s+de\s+)?grado\s+medio|fp\s+(?:de\s+)?grado\s+medio`,
    ),
    "5": word(
      String.raw`ciclo\s+(?:formativo\s+de\s+)?grado\s+superior|fp\s+(?:de\s+)?grado\s+superior|t[ée]cnico\s+superior`,
    ),
    "6": word(
      // Not "Diplomado en": a Latin American resume with no country signal is read in Spain, and
      // there a diplomado is a course.
      String.raw`graduad[oa]\s+en(?!\s+(?:educaci[óo]n\s+)?secundaria)|diplomatura`,
    ),
  },
});

/**
 * Brazil: day-first dates, Brazilian credentials and state codes ("São Paulo, SP"); a date of
 * birth or a photo is not judged. Ensino médio is upper secondary.
 */
export const BR: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "BR",
  name: "Brasil",
  status: "community",
  maintainers: [],
  phoneCountry: "BR",
  dateOrder: "DMY",
  regionCodes:
    "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
  cityNames: (
    "São Paulo|Sao Paulo|Rio de Janeiro|Belo Horizonte|Brasília|Brasilia|Salvador|Fortaleza|" +
    "Curitiba|Recife|Porto Alegre|Manaus|Belém|Belem|Goiânia|Goiania|Campinas|Florianópolis|" +
    "Florianopolis|Vitória|Vitoria|São José dos Campos|Santos|Ribeirão Preto|Joinville|Niterói|" +
    "Uberlândia|Londrina"
  ).split("|"),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  degrees: {
    "2": word(String.raw`ensino\s+fundamental|(?:1\s?[º°o]|primeiro)\s+grau`),
    "3": word(
      String.raw`ensino\s+m[ée]dio(?:\s+t[ée]cnico)?|curso\s+t[ée]cnico|(?:2\s?[º°o]|segundo)\s+grau`,
    ),
  },
});

/**
 * Mexico: day-first dates, state codes after a city ("Monterrey, N.L."), Mexican schooling
 * (secundaria is lower secondary, preparatoria upper); a date of birth or a photo is customary and
 * not judged.
 */
export const MX: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "MX",
  name: "México",
  status: "community",
  maintainers: [],
  phoneCountry: "MX",
  dateOrder: "DMY",
  // CDMX is the city itself, so it is in `cityNames`.
  regionCodes: [
    String.raw`N\.\s?L\.`,
    String.raw`D\.\s?F\.`,
    String.raw`Edo\.\s?(?:de\s)?M[ée]x\.`,
    String.raw`(?:Jal|Qro|Gto|Pue|Yuc|Chih|Coah|Son|Ver|Mich|Oax|Tamps|Sin|Ags|Hgo|Tab|Dgo|Zac|Mor|Gro|Chis|Nay|Camp|Tlax)\.`,
    String.raw`B\.\s?C\.(?:\s?S\.)?`,
    String.raw`Q\.\s?Roo\.?`,
    String.raw`S\.\s?L\.\s?P\.`,
  ],
  cityNames: (
    "Ciudad de México|CDMX|Guadalajara|Monterrey|Puebla|Querétaro|Tijuana|Zapopan|Mérida|" +
    "Aguascalientes|San Luis Potosí|Toluca|Chihuahua|Hermosillo|Saltillo|Mexicali|Culiacán|Cancún|" +
    "Morelia|Ciudad Juárez|San Pedro Garza García|Naucalpan|Oaxaca|Veracruz"
  ).split("|"),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  organisationWords: [
    String.raw`s\.\s?a\.\s?b\.\s+de\s+c\.\s?v\.`,
    String.raw`s\.?\s?a\.?\s+de\s+c\.?\s?v\.?`,
    String.raw`s\.\s?de\s+r\.\s?l\.(?:\s+de\s+c\.\s?v\.)?`,
    String.raw`s\.\s?a\.\s?p\.\s?i\.\s+de\s+c\.\s?v\.`,
  ],
  degrees: {
    "2": word(String.raw`secundaria`),
    "3": word(
      String.raw`preparatoria|prepa|bachillerato(?:\s+(?:general|tecnol[óo]gico))?|profesional\s+t[ée]cnico(?:\s+bachiller)?`,
    ),
    "5": word(String.raw`t[ée]cnico\s+superior\s+universitario|tsu`),
  },
});

/**
 * Argentina: day-first dates, Argentine schooling (secundario and polimodal are upper secondary, a
 * tecnicatura short-cycle tertiary); a date of birth or a photo is customary and not judged. CABA
 * and "Bs. As." are Buenos Aires itself ("Arcor, CABA"), so they are cities; PBA is its province.
 */
export const AR: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "AR",
  name: "Argentina",
  status: "community",
  maintainers: [],
  phoneCountry: "AR",
  dateOrder: "DMY",
  regionCodes: ["PBA"],
  cityNames: [
    ..."Buenos Aires|Córdoba|Rosario|Mendoza|La Plata|Mar del Plata|San Miguel de Tucumán|Tucumán|Salta|Neuquén|Bahía Blanca|Vicente López|Santa Fe|Corrientes|Posadas|San Isidro|Capital Federal|CABA".split(
      "|",
    ),
    String.raw`C\.A\.B\.A\.`,
    String.raw`Bs\.\s?As\.`,
  ],
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  degrees: {
    "3": word(
      String.raw`secundari[oa](?:\s+completo)?|polimodal|bachiller(?:ato)?(?:\s+con\s+orientaci[óo]n)?`,
    ),
    "5": word(String.raw`tecnicatura|t[ée]cnic[oa]\s+superior`),
    // A four-year teacher training is a first tertiary degree.
    "6": word(String.raw`profesorado(?=\s+(?:de|en|para)\s)`),
  },
});

/**
 * Colombia: day-first dates, "D.C." after Bogotá, Colombian schooling (a bachiller has finished
 * upper secondary; técnico profesional and tecnólogo are short-cycle tertiary, often from the
 * SENA); a date of birth or a photo is customary and not judged.
 */
export const CO: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "CO",
  name: "Colombia",
  status: "community",
  maintainers: [],
  phoneCountry: "CO",
  dateOrder: "DMY",
  regionCodes: [String.raw`D\.\s?C\.`],
  cityNames: [
    // "Bogotá D.C." without its comma.
    String.raw`Bogot[áa](?:\s+D\.\s?C\.)?`,
    ..."Medellín|Medellin|Cali|Barranquilla|Cartagena|Bucaramanga|Manizales|Cúcuta|Ibagué|Santa Marta|Villavicencio|Montería|Neiva|Envigado|Itagüí|Chía".split(
      "|",
    ),
  ],
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  schoolWords: ["sena"],
  degrees: {
    "3": word(String.raw`bachiller(?:\s+(?:acad[ée]mico|t[ée]cnico|comercial))?|bachillerato`),
    "5": word(
      String.raw`t[ée]cnic[oa]\s+profesional|tecn[óo]log[oa](?=\s+en\s)|tecnolog[íi]a\s+en`,
    ),
  },
});

/**
 * Chile: day-first dates, Chilean schooling (enseñanza media is upper secondary, a técnico de
 * nivel superior short-cycle tertiary, from INACAP or Duoc UC); a date of birth or a photo is
 * not judged.
 */
export const CL: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "CL",
  name: "Chile",
  status: "community",
  maintainers: [],
  phoneCountry: "CL",
  dateOrder: "DMY",
  regionCodes: ["RM"],
  cityNames: (
    "Santiago|Santiago de Chile|Valparaíso|Viña del Mar|Concepción|Antofagasta|La Serena|Temuco|" +
    "Puerto Montt|Rancagua|Talca|Arica|Iquique|Calama|Chillán|Osorno|Las Condes|Vitacura"
  ).split("|"),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  schoolWords: ["liceo", "inacap", String.raw`duoc(?:\s+uc)?`],
  // "SpA" is Chile's most common company form.
  organisationWords: ["spa", String.raw`e\.\s?i\.\s?r\.\s?l\.`],
  degrees: {
    "2": word(String.raw`ense[ñn]anza\s+b[áa]sica`),
    "3": word(
      String.raw`(?:licencia\s+de\s+)?ense[ñn]anza\s+media|(?:cuarto|4(?:\s?[°º]|to)?)\s+(?:a[ñn]o\s+)?medio`,
    ),
    "5": word(String.raw`t[ée]cnico\s+(?:de\s+nivel\s+superior|universitario)`),
  },
});

/**
 * Portugal: day-first dates, Portuguese schooling; a date of birth or a photo is not judged. The
 * `pt` pack defaults to Brazil; a +351 number, or this region asked for, reads Portugal.
 */
export const PT: AtsRegionPackInput = /* @__PURE__ */ deepFreeze({
  id: "PT",
  name: "Portugal",
  status: "community",
  maintainers: [],
  phoneCountry: "PT",
  dateOrder: "DMY",
  cityNames: (
    "Lisboa|Porto|Braga|Coimbra|Aveiro|Faro|Setúbal|Funchal|Évora|Guimarães|Leiria|Viseu|Oeiras|" +
    "Matosinhos|Amadora|Cascais|Sintra"
  ).split("|"),
  rules: {
    "ats-v2.privacy.dateOfBirth": { weight: 0 },
    "ats-v2.format.photo": { weight: 0 },
  },
  // "Lda." is Portugal's limited company.
  organisationWords: [String.raw`lda\.?`],
  degrees: {
    "2": word(String.raw`ensino\s+b[áa]sico|9\.?\s*[ºo]\s+ano`),
    "3": word(String.raw`ensino\s+secund[áa]rio|12\.?\s*[ºo]\s+ano`),
    "5": word(String.raw`ctesp|curso\s+t[ée]cnico\s+superior\s+profissional`),
  },
});
