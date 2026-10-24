import * as z from "zod/mini";

import { scriptName, wordList } from "../primitives.js";

/** Words for a role still held, in languages no built-in pack reads, by language id or script. */
const OPEN_ENDED: Record<string, string[]> = {
  it: ["oggi", "attuale", "in corso", "presente"],
  nl: ["heden", "huidig"],
  pl: ["obecnie", "nadal", "teraz"],
  sv: ["nuvarande", "pågående", "idag"],
  Cyrillic: ["настоящее время", "наст. время", "н.в.", "сейчас", "теперішній час"],
  el: ["σήμερα"],
  Arabic: ["حتى الآن", "الحاضر"],
  he: ["היום", "הווה"],
  ja: ["現在", "至今"],
  Han: ["至今", "现在", "現在", "目前"],
  ko: ["현재"],
  th: ["ปัจจุบัน"],
};

/** Text-shape vocabulary the scorer itself reads, as opposed to the parser or the matcher. */
export const engineTextSchema = z.prefault(
  z.object({
    /**
     * The language (ISO 639) this policy's own vocabulary is written in: what a resume is read as
     * when no attached pack recognises it, unless it is written in one of `otherLanguages`.
     */
    language: z._default(
      z.string().check(z.regex(/^[a-z]{2,3}$/, "an ISO 639 language code")),
      "en",
    ),
    /**
     * Words common in `language` and rare in the others, by which a resume is recognised as
     * written in it: at least three different ones, making up 3% of the words.
     */
    detectionWords: z._default(z.array(z.string().check(z.minLength(1))), [
      "the",
      "and",
      "of",
      "with",
      "for",
      "to",
      "from",
      "by",
      "at",
      "are",
      "were",
      "our",
      "you",
      "your",
      "this",
      "that",
      "which",
      "have",
      "has",
      "into",
      "across",
      "than",
      "using",
      "including",
      "while",
      "led",
      "built",
      "managed",
      "designed",
      "developed",
      "reduced",
      "improved",
      "created",
      "launched",
      "delivered",
      "years",
      "skills",
      "experience",
      "education",
      "summary",
      "university",
      "work",
      // Heading and date words, so a terse English resume naming Spanish places stays English.
      "present",
      "employment",
      "history",
      "high",
      "school",
    ]),
    /**
     * Languages this policy has no vocabulary for, each recognised by its script, or by at least
     * three different of its words making up 3% of the words. A resume in one of them, in no
     * attached pack's language and not in `language`, is read in none (ISO 639 "und"), so rules
     * limited to some `languages` are dropped for it. A Latin-script one also needs more of its
     * words than `detectionWords` find. Empty: every resume no pack recognises is read in
     * `language`. `id`, an ISO 639 code, names the language in the report; without it the
     * report names the script, or "und" for an entry of words alone.
     */
    otherLanguages: z._default(
      z.array(
        z
          .object({
            id: z.optional(z.string().check(z.regex(/^[a-z]{2,3}$/, "an ISO 639 language code"))),
            script: z.optional(scriptName),
            detectionWords: z._default(z.array(z.string().check(z.minLength(1))), []),
            /**
             * Its words for a role still held ("oggi", "obecnie"), by which a model's reading of
             * such a resume is checked when it says a role is current.
             */
            openEnded: z._default(z.array(z.string().check(z.minLength(1))), []),
          })
          .check(
            z.refine((other) => other.script !== undefined || other.detectionWords.length >= 10, {
              message: "a language needs a script or at least ten detection words",
            }),
          ),
      ),
      [
        // Spanish, Portuguese, Italian, French, German, Dutch, Polish and Swedish: words not
        // shared with English, a place, a name or a web domain.
        "es con para por una desde como sus que más también años experiencia",
        "pt em uma não são dos das pelo pela também ao para como",
        "it di della delle dei nel nella con sono che degli alla anni",
        "fr une pour avec dans sur chez des du au aux les nous",
        "de und der für mit bei von eine sowie durch zur zum auf",
        "nl het een voor naar zijn ook bij werkervaring jaar ervaring",
        "pl oraz dla jest się doświadczenie pracy przez jako lat zespołu",
        "sv och för att som inom samt erfarenhet utveckling arbetat ansvarig",
      ]
        .map(
          (
            words,
          ): { id?: string; script?: string; detectionWords: string[]; openEnded: string[] } => {
            const [id, ...detectionWords] = words.split(" ");
            return { id, detectionWords, openEnded: OPEN_ENDED[id!] ?? [] };
          },
        )
        .concat(
          // A script one language writes names it; kana before Han, so Japanese is not named Chinese.
          "Cyrillic Greek:el Arabic Hebrew:he Hiragana:ja Katakana:ja Han Hangul:ko Thai:th Devanagari Bengali Tamil:ta Telugu:te"
            .split(" ")
            .map((entry) => {
              const [script, id] = entry.split(":");
              return {
                ...(id && { id }),
                script,
                detectionWords: [],
                openEnded: OPEN_ENDED[id ?? script!] ?? [],
              };
            }),
        ),
    ),
    contentLineVerbs: z._default(wordList("text.contentLineVerbs"), [
      "managed",
      "led",
      "built",
      "developed",
      "designed",
      "improved",
      "reduced",
      "increased",
      "delivered",
      "achieved",
      "created",
      "generated",
      "optimized",
      "launched",
      "spearheaded",
      "engineered",
      "maintained",
      "scaled",
      "automated",
    ]),
    /**
     * The verbs a content line scores for naming, read by an `actionVerbRatio` rule with no
     * `pattern` of its own: present and past. Regular past tenses need no entry (see
     * `actionVerbForms`).
     */
    actionVerbs: z._default(wordList("text.actionVerbs"), [
      "led",
      "lead",
      "leads",
      "leading",
      "built",
      "build",
      "builds",
      "cut",
      "cuts",
      "ran",
      "run",
      "runs",
      "drove",
      "drive",
      "drives",
      "grew",
      "grow",
      "grows",
      "won",
      "win",
      "wins",
      "made",
      "make",
      "makes",
      "wrote",
      "write",
      "writes",
      "rewrote",
      "sold",
      "sell",
      "sells",
      "taught",
      "teach",
      "teaches",
      "oversaw",
      "oversee",
      "oversees",
      "began",
      "brought",
      "bring",
      "brings",
      "held",
      "kept",
      "met",
      "spoke",
      "took",
      "gave",
      "rebuilt",
      "undertook",
      "overhaul",
      "overhauls",
      "own",
      "owns",
      "owned",
      "manage",
      "manages",
      "managed",
      "develop",
      "develops",
      "developed",
      "design",
      "designs",
      "designed",
      "deliver",
      "delivers",
      "delivered",
      "improve",
      "improves",
      "improved",
      "reduce",
      "reduces",
      "reduced",
      "increase",
      "increases",
      "increased",
      "create",
      "creates",
      "created",
      "launch",
      "launches",
      "launched",
      "automate",
      "automates",
      "automated",
      "scale",
      "scales",
      "scaled",
      "migrate",
      "migrates",
      "migrated",
      "implement",
      "implements",
      "implemented",
      "architected",
      "coordinate",
      "coordinates",
      "coordinated",
      "negotiate",
      "negotiates",
      "negotiated",
      "mentored",
      "coached",
      "train",
      "trains",
      "trained",
      "hire",
      "hires",
      "hired",
      "recruit",
      "recruits",
      "recruited",
      "closed",
      "exceed",
      "exceeds",
      "exceeded",
      "achieve",
      "achieves",
      "achieved",
      "secured",
      "establish",
      "establishes",
      "established",
      "streamline",
      "streamlines",
      "streamlined",
      "optimize",
      "optimizes",
      "optimized",
      "optimise",
      "optimises",
      "optimised",
      "analyze",
      "analyzes",
      "analyzed",
      "analyse",
      "analyses",
      "analysed",
      "maintain",
      "maintains",
      "maintained",
      "supported",
      "directed",
      "planned",
      "organize",
      "organizes",
      "organized",
      "organise",
      "organises",
      "organised",
      "execute",
      "executes",
      "executed",
      "generate",
      "generates",
      "generated",
      "spearhead",
      "spearheads",
      "spearheaded",
      "partnered",
      "collaborate",
      "collaborates",
      "collaborated",
      "presented",
      "publish",
      "publishes",
      "published",
      "researched",
      "evaluate",
      "evaluates",
      "evaluated",
      "tested",
      "deploy",
      "deploys",
      "deployed",
      "refactor",
      "refactors",
      "refactored",
      "integrate",
      "integrates",
      "integrated",
      "resolve",
      "resolves",
      "resolved",
      "troubleshoot",
      "troubleshoots",
      "troubleshot",
      "administer",
      "administers",
      "administered",
      "configure",
      "configures",
      "configured",
      "monitored",
      "documented",
      "reviewed",
      "prepare",
      "prepares",
      "prepared",
      "conduct",
      "conducts",
      "conducted",
      "expand",
      "expands",
      "expanded",
      "boost",
      "boosts",
      "boosted",
      "accelerate",
      "accelerates",
      "accelerated",
      "saved",
      "lowered",
      "raise",
      "raises",
      "raised",
      "consolidate",
      "consolidates",
      "consolidated",
      "standardize",
      "standardizes",
      "standardized",
      "standardise",
      "standardised",
      "transform",
      "transforms",
      "transformed",
      "modernize",
      "modernizes",
      "modernized",
      "redesign",
      "redesigns",
      "redesigned",
      "introduce",
      "introduces",
      "introduced",
      "pioneer",
      "pioneers",
      "pioneered",
      "initiate",
      "initiates",
      "initiated",
      "define",
      "defines",
      "defined",
      "prototyped",
      "produce",
      "produces",
      "produced",
      "authored",
      "drafted",
      "forecasted",
      "budgeted",
      "audited",
      "ensure",
      "ensures",
      "ensured",
      "engineered",
      "ship",
      "ships",
      "shipped",
      "founded",
      "co-founded",
      "cofounded",
      "handle",
      "handles",
      "handled",
      "guided",
      "onboard",
      "onboards",
      "onboarded",
      "sourced",
      "cultivate",
      "cultivated",
      "convert",
      "converts",
      "converted",
      "renegotiated",
      "eliminate",
      "eliminates",
      "eliminated",
    ]),
    /**
     * Patterns that make a bullet's first word an action verb without its being listed: in
     * English a regular past tense. Matched against the whole first word; "-eed" is left out.
     */
    actionVerbForms: z._default(wordList("text.actionVerbForms"), [String.raw`\p{L}{3,}(?<!e)ed`]),
    /**
     * Whether an action verb counts anywhere in a line, not only its opening words: for
     * verb-final languages such as Hindi.
     */
    actionVerbAnywhere: z._default(z.boolean(), false),
    /**
     * Instructions addressed to an AI screener rather than to a person, as patterns. A tool's
     * name alone is never one. Language packs add their own.
     */
    injectionPhrases: z._default(wordList("text.injectionPhrases"), [
      // Up to three determiners. The lookbehind skips an engineer describing a system ("our
      // model must ignore previous instructions").
      String.raw`(?<!(?:model|models|llm|llms|system|systems|classifier|classifiers|pipeline|pipelines|filter|filters|guardrail|guardrails|parser|parsers)(?:\s{1,3}(?:must|should|shall|will|would|can|could|may|might|cannot|to|never|not|always|then|now))?\s{1,3})(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|of|my|these|those)\s+){0,3}(?:previous|prior|above|earlier|preceding|other)\s+(?:instructions?|prompts?|directions?|rules|context)`,
      String.raw`you\s+(?:must|should|shall|will|need\s+to|are\s+to)\s+(?:now\s+)?(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|of|my|these|those)\s+){0,3}(?:previous|prior|above|earlier|preceding|other)\s+(?:instructions?|prompts?|directions?|rules|context)`,
      // Aimed at the grading: "disregard the rubric", "give this resume a 10/10".
      String.raw`(?<!(?:model|models|llm|llms|system|systems|classifier|classifiers|pipeline|pipelines|filter|filters|guardrail|guardrails|parser|parsers)(?:\s{1,3}(?:must|should|shall|will|would|can|could|may|might|cannot|to|never|not|always|then|now))?\s{1,3})(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|these|those)\s+){0,2}(?:rubric|(?:scoring|grading|screening|evaluation)\s+(?:rubric|criteria|guidelines|rules))`,
      String.raw`(?:give|award|assign)\s+(?:this|my)\s+(?:resume|cv|candidate|applicant|profile|application)\s+(?:an?\s+|the\s+)?(?:10\s*/\s*10|100\s*/\s*100|perfect|full\s+marks|top\s+(?:score|marks|rating)|highest|maximum)`,
      // Not "system prompt:", which an engineer writes about the prompts they built.
      String.raw`(?:new|updated|real)\s+(?:instructions?|prompt)\s*:|system\s+instructions?\s*:`,
      String.raw`(?:you\s+are|pretend\s+to\s+be)\s+(?:an?\s+)?(?:ai|assistant|language\s+model|llm|resume\s+screener)`,
      // A role said to a screener; not "If you are a hiring manager...", written to a person.
      String.raw`(?:(?<!(?:if|when)\s{1,3})you\s+are|pretend\s+to\s+be)\s+(?:an?\s+)?(?:recruiter|hiring\s+manager)`,
      // "Act as hiring manager" is a job description, so only with an AI as its object.
      String.raw`act\s+as\s+(?:an?\s+)?(?:(?:ai|automated)\s+(?:assistant|recruiter|screener|reviewer|hiring\s+manager|model)|language\s+model|llm|resume\s+screener)`,
      String.raw`(?:if|when)\s+you\s+are\s+(?:an?\s+)?(?:ai|llm|language\s+model|automated|bot)`,
      // Addressed, so punctuated: "Note to AI:".
      String.raw`note\s+(?:to|for)\s+(?:the\s+)?(?:ai|llm|chatgpt|model|screener|automated\s+\p{L}+)\s*[:,–—-]`,
      // "This candidate", never "the candidate", which recruiters' bullets use.
      String.raw`(?:rank|rate|score|grade|mark|recommend|evaluate)\s+this\s+(?:candidate|applicant|resume|profile)\s+(?:as\s+|at\s+)?(?:the\s+)?(?:highest|top|best|first|100|10|perfect|excellent|highly)`,
      String.raw`this\s+(?:candidate|applicant)\s+(?:is|should\s+be)\s+(?:the\s+|an?\s+)?(?:best|most\s+qualified|perfect|ideal|top|strongest|exceptional)\s+(?:fit|match|candidate|choice)`,
      String.raw`(?:hire|shortlist|advance|select|interview)\s+this\s+(?:candidate|applicant)\s+(?:immediately|now|first|without)`,
      // A dictated verdict: quoted, "only with", or ending the sentence; not "respond with 100
      // percent accuracy" or "answer with yes or no".
      String.raw`(?:respond|reply|answer|output)\s+(?:only\s+with\s+["'“]?|with\s+["'“])(?:yes|hire|qualified|100(?!\s*(?:%|percent)))`,
      String.raw`(?:respond|reply|answer|output)\s+with\s+(?:yes|hire|qualified)(?=\s*(?:[.!;"”\n]|$))`,
      // A markdown "### System Design" heading is not a prompt delimiter; "### System:" is.
      String.raw`<\|?(?:im_start|system|endoftext)\|?>|\[/?(?:inst|system)\]|###\s*(?:instructions?|system\s*:)`,
    ]),
    /**
     * Words that say an injection phrase was caught, not given (`Built a filter that flags
     * "ignore previous instructions"`). A quoted phrase within three words of one (no comma or
     * colon between) is an example and is not counted. Not on a labelled line, not unquoted, not
     * in hidden text, and never a quote naming an `injectionTargets` entry or holding a verdict
     * (`injectionVerdicts`) beside another phrase.
     */
    injectionMentionVerbs: z._default(wordList("text.injectionMentionVerbs"), [
      // With "-s", "-ed" and "-ing" forms.
      String.raw`(?:flag|detect|block|filter|prevent|red[\s-]?team|test|scan|spot|reject)(?:s|g?ed|g?ing|ned|ning|ted|ting)?`,
      String.raw`catch(?:es|ing)?|caught|detections?`,
      String.raw`(?:mitigat|saniti[sz])(?:e|es|ed|ing)`,
    ]),
    /** What a quote that tells the screener what to make of this resume names: never an example. */
    injectionTargets: z._default(wordList("text.injectionTargets"), [
      String.raw`this\s+(?:candidate|applicant|resume|cv|profile|application)`,
      String.raw`(?:rank|rate|score|grade|hire|shortlist|approve|select|advance|recommend)\s+me`,
    ]),
    /**
     * What an injection phrase says when it dictates a verdict or grade ("respond with hire").
     * A quote holding such a phrase and another is a prompt, never an example.
     */
    injectionVerdicts: z._default(wordList("text.injectionVerdicts"), [
      String.raw`(?:respond|reply|answer|output)\s+(?:only\s+)?with`,
      String.raw`\d+\s*/\s*\d+`,
      String.raw`(?:rank|rate|score|grade|hire|shortlist|approve|select|advance|recommend)`,
      String.raw`(?:this|my)\s+(?:candidate|applicant|resume|cv|profile|application)`,
    ]),
    /**
     * Headings of a list of works. Lines under one shaped as citations (a year, a quoted title,
     * "et al.", initials) are not bullets: verb and metric rules skip them and keyword stuffing
     * does not count a term across them.
     */
    citationHeadings: z._default(wordList("text.citationHeadings"), [
      String.raw`publications?`,
      String.raw`presentations?`,
      String.raw`(?:invited\s+)?talks`,
      "conferences",
      "patents",
      "posters",
    ]),
  }),
  // `prefault`: `default` would return `{}` unparsed and drop the defaults above.
  {},
);
