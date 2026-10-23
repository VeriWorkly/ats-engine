---
"@veriworkly/ats-engine": minor
---

German, French and Hindi resumes read nearly as well as English ones, and Spanish and Portuguese are read too.

Measured against 0.19.0 on resumes an independent reviewer wrote for each language (its own layouts and labels: stacked, employer-first, dates first, pipe tables, LinkedIn exports, all-caps headings), read as text, DOCX and PDF alike, with the language detected:

| Language   | 0.19.0 | 0.20.0 |
| ---------- | ------ | ------ |
| German     | 80.0%  | 99.2%  |
| French     | 89.8%  | 97.6%  |
| Hindi      | 88.4%  | 99.2%  |
| Spanish    | 24.3%  | 98.0%  |
| Portuguese | 23.3%  | 99.3%  |

No field any of them read right in 0.19.0 is read wrong now, and passing the language (`--lang`, `language`) gives the same. `npm run bench` now also measures 30 generated resumes in each of the five languages and fails on any new miss. English: on 1,089 runs (every English fixture, 300 generated resumes, the private graded set, review cases, alone and with postings) only the changes below differ from 0.19.0, each one a field read better.

- **Breaking:** a city after the employer is where the role is worked (decision D1): "Firma GmbH, Berlin", "Deutsche Bank, Frankfurt", "Infosys — Bengaluru" and "Thar Insurance, चेन्नई" read the employer alone. The cities are data, a new pack field `cityNames` that every built-in language and region pack fills, leaving out names that are also words or employers ("Nice", "Reading", "Phoenix"). With no region known, every attached region's cities are read; the base policy names none. A line that is only a city's name stays what it was: it may be the employer itself ("Santander", "Cambridge").
- **Breaking:** a word that opens a date range is read with it, so it leaves the employer: "Software Engineer, Acme Corp, from Jan 2020 to Present" reads employer "Acme Corp", not "Acme Corp, from" (new field `rangeOpeners`: "from" in the base; "von", "de", "du", "desde" in the packs). A month and its year may be joined by a slash ("jan/2019") or by a word a pack lists (`monthYearJoiners`: Spanish and Portuguese "de", as in "marzo de 2020", LinkedIn's form).
- **Breaking:** dates first, then the title, then the employer on a line of its own ("Sep 2018 – Aug 2021" over "Software Engineer" over "Capgemini, Toulouse") read the employer; 0.19.0 left it empty. A line that is only a date range is never joined onto the line above as its wrapped end, so a lower-case "janv. 2021 – aujourd'hui" after a bullet starts its role.
- **Breaking:** an employer ending in a dotted abbreviation keeps its last dot: "Telefónica S.A.", "Embassy of the U.S.", "J.P.L."; "Acme Inc." still reads "Acme Inc".
- **Breaking:** headings, degrees and titles the packs did not know. German "Weiterbildung(en)" and "Fort- und Weiterbildung" open certifications; Hindi "पेशेवर अनुभव" and "प्रोफेशनल अनुभव" open experience; LinkedIn's exported headings in each language ("Kontakt", "Top-Kenntnisse", "Principales compétences", "Contactar", "Extracto", "Contato", "Principais competências") are headings, not the name. A pack heading that extends one of the policy's ("Contactar" after "contact") is a heading. Hindi बी.एससी., बी.कॉम (6), एम.एससी., एम.कॉम (7) and पीएच.डी. (8), Québec's DEC and CEGEP (5), German "-manager(in)" and "-designer(in)" compounds and Hindi "वास्तुकार", "डिज़ाइनर", "प्रशासक" are read. A German LinkedIn export with hardly a sentence is detected as German by its CV words ("berufserfahrung", "kenntnisse", "heute", "jahre").
- **Breaking:** an expiry word may follow its date, as Hindi writes it ("2027 तक वैध"): a new pack field, `credentialWords.expiresAfter`. French "valable jusqu'en 2027" is an expiry.
- New language packs `es` (Spanish, Spain and Latin America) and `pt` (Portuguese, Brazil first) and region packs `ES` (Spain), `BR` (Brazil) and `PT` (Portugal, read from a +351 number), all `community` until a native speaker reviews them. Spanish is not detected by articles, "de", "san" or short prepositions, so an English resume naming "Los Angeles" or "Supermercado El Rey y Más" stays English; Spanish and Portuguese share no detection word. "Cargo en Empresa" splits where a legal form ends the company ("Diseñadora UX en Acme S.A.", Portuguese "Analista na Exemplo Ltda."), never in a title such as "Especialista en Marketing". A Spanish or Portuguese resume was read as English in 0.19.0; it is now read in its language.
- The default policy's fingerprint is `ats-v2+7f07e3e7` in this release. The `./locales` bundle grows from 77.5 KB to 86.6 KB gzipped with the new packs, regions, cities and headings.
