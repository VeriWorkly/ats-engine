---
"@veriworkly/ats-engine": minor
---

A resume in a language no pack reads can be read with AI help: step 5 of the language plan.

- `ats-engine check --ai` on a resume the engine names as unsupported (Italian, Dutch, Russian, Japanese…) first sends the whole resume, contact details included, to the model you choose, which returns its fields (`convertResume`). Every name, employer, title, school, skill, email and link must appear in the file, or it is dropped, and so must every bullet and summary before it is scored (`groundedText`), so a bullet the model wrote, or one text planted in the resume steered it to write, adds no keyword; the engine then scores what is left as a structured document, and the analysis runs on that report. The output says "Read with AI help" above the report, and `--json` adds `readWithAi` (provider, model, language, values dropped). If the model fails, the engine's own reading stands and the exit code is 1. An English, German, French, Hindi, Spanish or Portuguese resume is read as before.
- New in `/ai`: `groundedText(result, source)` blanks the summaries and bullets of a `convertResume` result that do not occur in the source, and `convertedToDocument(result)` turns a `convertResume` result into an `ats-resume@1` document for `check`. An entry whose identifying fields were all blanked as ungrounded is dropped, never scored on its bullets alone.
- `check` accepts in `languages` a language the policy recognises but no pack reads (`text.otherLanguages`, by id or script: "it", "Cyrillic"), and reads the resume as detection would: no pack, the English writing rules off. The AI reading scores its document so, keeping its bullets from the English rules.
- The base degrees read Italian, Polish, Russian, Swedish and Dutch degree names ("Laurea" 6, "Laurea magistrale" 7, "Бакалавр" 6, "Магистр" 7, "Licencjat" 6, "Dottorato" 8, "Matura" 3).
- Each of `text.otherLanguages` gains `openEnded`, its words for a role still held ("oggi", "heden", "obecnie", "настоящее время", "至今"), so a model's "current" for such a resume is checked against the file as it is for a pack's language.
- The CLI's AI error messages name the request, not only the analysis ("did not return a usable answer").
