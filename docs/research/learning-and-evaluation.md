# Learning science, tutor authoring and evaluation design

Status: research note (input for design decisions, not a decision). Author: research (role).
Retrieval date for every source below: **2026-10-03**. Terms follow `docs/glossary.md`.

## How to read this note

- **Read** = what was actually read: `FT` full text (pages named), `ABS` abstract, `DOC` official
  page/spec, `META` bibliographic metadata only. Abstracts marked *(recon.)* were reconstructed from
  OpenAlex's inverted index; some came back with garbled word order, and only robust content is used.
- **Tier**: `T1` official spec, documentation or repository; `T2` peer-reviewed paper or research
  preprint; `T3` search snippet, press or blog. A T3 finding never carries a claim alone.
- **Claim scope** says what the source supports, for which population and task. Nothing here is
  stretched beyond it. Effect sizes appear only where they were read in the source.
- Volatile numbers (benchmark scores, model names) are snapshots and must be rechecked before reuse.

## Summary

1. **Closest prior work: CTAT example-tracing tutors** (Carnegie Mellon). An author demonstrates
   steps in a tutor interface; a *behavior graph* records them. The author then generalizes it
   (alternative paths, ordered/unordered groups, input matchers, Excel-like formulas), annotates
   multi-level hints and *incorrect-action links* with error-specific messages, and mass-produces
   problem variants from a spreadsheet (L001, L002). Simulated learners (SimStudent, Apprentice
   Learner, AI2T) induce general rules from demonstrations plus correctness feedback (L003–L006).
   TutorGym already puts AI agents into the same tutors as students (L009). Practonaut is **not
   the first** to do demonstration-based authoring or put humans and agents in one tutor.
2. Documented limits of that line of work: only problems with an at most **moderately branching
   solution space**; hooking up an external problem-solving environment "typically requires
   extensions" to it; few tutors outside STEM (L001). In TutorGym, no tested LLM beat chance at
   flagging incorrect steps (L009, model snapshot 2025).
3. The learning evidence supports **guided practice with planned errors and fading**, not "free
   exploration". Error management training beat error-avoidant training in a meta-analysis
   (d = 0.44, larger for transfer, L022). Pure exploration did not beat tutorials in a spreadsheet
   study, while guided problem solving beat both (L019). Worked examples help novices and can hurt
   more experienced learners (L010–L012).
4. A small study (n ≈ 5–12) can show **feasibility** and give a weak direction. It cannot estimate
   an effect size or show transfer in general (L028, L029).
5. Independent result checkers fail in documented ways: empty answers counted as success (L038),
   agents patching the grader (L039), reading the solution from repository history (L041),
   rewriting tests (L040). The checker therefore has to be isolated, tested with negative controls
   and kept separate from the hidden-case material.

## 1. Source register

### A. Authoring by demonstration (closest prior work)

| ID | Source | Tier / Read | Claim scope | Uncertainty |
|---|---|---|---|---|
| L001 | Aleven, McLaren, Sewall, van Velsen, Popescu, Demi, Ringenberg, Koedinger (2016). *Example-Tracing Tutors: Intelligent Tutor Development for Non-programmers.* IJAIED. DOI [10.1007/s40593-015-0088-2](https://doi.org/10.1007/s40593-015-0088-2); author PDF <http://www.cs.cmu.edu/~aleven/Papers/2016/Aleven_etal_IJAIED2016_CTAT.pdf> | T2 / FT pp. 4–10, 20–24 + ABS | The authoring process: a Behavior Recorder turns demonstrated steps into a behavior graph. The graph "is therefore expected to capture *all* solution strategies that are reasonable within the given interface". Further features: input matchers, formulas, ordered/unordered groups (nestable), hints on links, incorrect-action links with error-specific messages, KC labels with Bayesian Knowledge Tracing, Mass Production, tool/tutor separation. One project embeds a CTAT tutor in Google Sheets. Limits: "only problems that have no more than a moderately-branching solution space (unless many branches are isomorphic …)"; external environments "typically require extensions"; no adaptivity to affect, metacognition or motivation; few non-STEM tutors. Abstract: "4–8 times as cost-effective" as estimates in the literature; ~44,000 students; 40 % of DataShop data sets. | Author manuscript; pp. 11–19 (single tutor studies) not read. Cost figure is the authors' comparison with literature estimates, not a controlled measurement. |
| L002 | CMUCTAT wiki: [Example-tracing Tutors](https://github.com/CMUCTAT/CTAT/wiki/Example-tracing-Tutors) (last edited 2020-08-05), [Mass Production](https://github.com/CMUCTAT/CTAT/wiki/Mass-Production); repo metadata via `api.github.com/repos/CMUCTAT/CTAT` | T1 / DOC | In Demonstrate mode every step starts as "Correct Action". The author changes the action type to incorrect or suboptimal and adds "common student misconceptions … as well as alternative correct paths". Ordered vs unordered groups; formulas test student input; multiple hint levels per link. Mass production fills `%(variable)%` templates from a spreadsheet. Repo: not archived, last push 2026-06-05, license reported as `NOASSERTION`. | Wiki pages are old; current behavior not verified. Any reuse of CTAT code needs its license read first. |
| L003 | Matsuda, Cohen, Koedinger (2015; online 2014). *Teaching the Teacher: Tutoring SimStudent Leads to More Effective Cognitive Tutor Authoring.* IJAIED. DOI [10.1007/s40593-014-0020-1](https://doi.org/10.1007/s40593-014-0020-1) | T2 / ABS | Two modes: *Authoring by Demonstration* (SimStudent generalizes worked-out examples) and *Authoring by Tutoring* (author poses problems, gives feedback, demonstrates on hint request). Tutoring gave a more accurate expert model at equal completeness and took less time, "because the expert model generated by tutoring benefits from negative feedback". | Domain and study size not in abstract. |
| L004 | MacLellan, Harpstead, Patel, Koedinger (2016). *The Apprentice Learner Architecture: Closing the loop between learning theory and educational data.* EDM 2016. <https://chrismaclellan.com/media/publications/edm_submission_gupeqSq.pdf> | T2 / FT pp. 1–3 | Three learning mechanisms: *how* (search for a function sequence explaining a demonstration), *where* (perceptual patterns for relevant interface elements), *when* (conditions under which the sequence applies, refined by correctness feedback). Result: IF-THEN production rules. Learners request a demonstration when no skill applies. Evaluated against data from two fraction tutors. | Simulation of student data, not an authoring-quality study. Prior function and feature knowledge is hand-given (for example `Add`, `isPlusSign`). |
| L005 | Weitekamp, Harpstead, Koedinger (2020). *An Interaction Design for Machine Teaching to Develop AI Tutors.* CHI 2020. DOI [10.1145/3313831.3376226](https://doi.org/10.1145/3313831.3376226) | T2 / ABS | Example-tracing and Authoring by Tutoring "still suffer from long authoring times or difficulty creating complete models". An AL-based design (transparency, input flexibility, control over problem solving) reached greater completeness in less time. | Size of the user study not in abstract. |
| L006 | Weitekamp, Harpstead, Koedinger (2024). *AI2T: Building Trustable AI Tutors by Interactively Teaching a Self-Aware Learning Agent.* arXiv [2411.17924](https://arxiv.org/abs/2411.17924) | T2 / ABS | Authors give a few step-by-step solutions and grade AI2T's attempts. After "20-30 minutes" it induces model-tracing rules. STAND estimates its own certainty on unseen steps, so authors can judge when training is sufficient. The authors call the result "more reliable than hallucination-prone LLMs". They cite "200-300 hours of programming per hour of instruction" for complex ITSs. | Preprint (v1). The 200–300 h figure is cited, not measured here. |
| L007 | Smith, Gupta, MacLellan (2024). *Apprentice Tutor Builder.* arXiv [2404.07883](https://arxiv.org/abs/2404.07883) | T2 / ABS | Drag-and-drop interface building plus agent training through demonstrations, feedback and labels. Study with 14 instructors: they liked the flexibility and the speed of teaching the agent, but "often desired additional time-saving features". | Usability study; no learner outcomes. |
| L008 | Calo, MacLellan (2024). *Towards Educator-Driven Tutor Authoring: Generative AI Approaches for Creating Intelligent Tutor Interfaces.* arXiv [2405.14713](https://arxiv.org/abs/2405.14713) | T2 / ABS | LLM-generated tutor **interfaces** at whole-interface and component level, refined by the educator through direct manipulation. "Preliminary evaluation" suggests efficiency gains. | Covers interfaces, not step models or correctness. Small evaluation. |
| L009 | Weitekamp, Siddiqui, MacLellan (2025). *TutorGym: A Testbed for Evaluating AI Agents as Tutors and Students.* arXiv [2505.01563](https://arxiv.org/abs/2505.01563) (HTML v1 read) | T2 / ABS + excerpts | Puts AI agents into existing ITSs (223 tutor domains) as tutors or as students. Behavior graphs are "finite state machines" with "unordered groups of actions, skippable actions, tutor-performed actions … and short programs that flexibly match variations". "No model exceeded chance (i.e. 50%) at identifying incorrect actions." Step demonstrations reached ~52–70 % accuracy. In-context LLM "students" gave human-like learning curves. | Model snapshot: Sonnet-3.5, Haiku-3.5, GPT-4o, DeepSeek-v2.5. Recheck with current models. |

### B. Learning by doing and transfer

| ID | Source | Tier / Read | Claim scope | Uncertainty |
|---|---|---|---|---|
| L010 | Atkinson, Derry, Renkl, Wortham (2000). *Learning from Examples: Instructional Principles from the Worked Examples Research.* RER 70(2):181–214. DOI [10.3102/00346543070002181](https://doi.org/10.3102/00346543070002181) | T2 / ABS (recon.) | Review: several examples per problem type, varied surface features, examples placed next to matched practice problems, prompted self-explanation. Worked examples belong to early skill development. | Review of mostly math/science; not software. |
| L011 | Renkl, Atkinson (2003). *Structuring the Transition From Example Study to Problem Solving …* Educ. Psychologist 38(1):15–22. DOI [10.1207/S15326985EP3801_3](https://doi.org/10.1207/S15326985EP3801_3) | T2 / ABS (recon.) | Examples beat problem solving early; problem solving is better later. Proposes **fading**: problem-solving elements are added step by step. Adaptive fading is named as future work. | Theory plus cited evidence; no pooled effect. |
| L012 | Kalyuga, Ayres, Chandler, Sweller (2003). *The Expertise Reversal Effect.* Educ. Psychologist 38(1):23–31. DOI [10.1207/S15326985EP3801_4](https://doi.org/10.1207/S15326985EP3801_4) | T2 / ABS (recon.) | Techniques that help novices "can lose their effectiveness and even have negative consequences" with experienced learners. | Review; size of the reversal varies by study. |
| L013 | Kapur (2008). *Productive Failure.* Cognition and Instruction 26(3):379–424. DOI [10.1080/07370000802212669](https://doi.org/10.1080/07370000802212669) | T2 / ABS (recon.) | Grade-11 kinematics, collaborative ill-structured problem solving first. Despite poor solutions at first, these students did better on individual near- and far-transfer measures. | One school domain; "existence proof". |
| L014 | Sinha, Kapur (2021). *When Problem Solving Followed by Instruction Works: Evidence for Productive Failure.* RER. DOI [10.3102/00346543211019105](https://doi.org/10.3102/00346543211019105) | T2 / ABS | Meta-analysis, 53 studies, 166 comparisons: problem solving before instruction vs. instruction first, Hedges' g 0.36 [0.20; 0.51]. With high fidelity to PF design, g 0.37–0.58. Reversed for grades 2–5 and for domain-general skills. Bias-adjusted estimate g 0.87. | Concepts in school/university settings, not procedural software skill. |
| L015 | Roediger, Karpicke (2006). *Test-Enhanced Learning.* Psychological Science. DOI [10.1111/j.1467-9280.2006.01693.x](https://doi.org/10.1111/j.1467-9280.2006.01693.x) | T2 / ABS (recon.) | Prose passages. Restudying won at 5 min; prior testing gave substantially better retention at 2 days and 1 week. Restudying raised learners' **confidence**. | Verbal memory, not procedures. Supports a **delayed** test and not relying on self-ratings. |
| L016 | Collins, Brown, Newman (1987). *Cognitive Apprenticeship: Teaching the Craft of Reading, Writing, and Mathematics.* Tech. Report 403, ERIC [ED284181](https://files.eric.ed.gov/fulltext/ED284181.pdf) | T2 / FT p. 1 (ERIC résumé), Table 5 | Framework, not an experiment. Methods: modelling, coaching, scaffolding and fading, articulation, reflection, exploration. Sequence: increasing complexity, increasing diversity, global before local skills. | Conceptual; no outcome data. |
| L017 | Barnett, Ceci (2002). *When and where do we apply what we learn? A taxonomy for far transfer.* Psychological Bulletin 128(4):612–637. DOI [10.1037/0033-2909.128.4.612](https://doi.org/10.1037/0033-2909.128.4.612) | T2 / ABS (recon.) | Nine dimensions along which transfer can differ. "Estimation of a single effect size for far transfer is misguided." | Abstract only; dimensions not listed here. |
| L018 | Carroll, Smith-Kerker, Ford, Mazur-Rimetz (1987). *The Minimal Manual.* Human-Computer Interaction 3(2):123–153. DOI [10.1207/s15327051hci0302_2](https://doi.org/10.1207/s15327051hci0302_2) | T2 / ABS (recon.) | Briefer manual that coordinates attention between system and manual and "specifically trains error recognition and recovery". Two experiments: more efficient learning progress than a comparable commercial manual. | 1980s office systems; no effect size in abstract. |
| L019 | Charney, Reder, Kusbit (1990). *Goal Setting and Procedure Selection in Acquiring Computer Skills: A Comparison of Tutorials, Problem Solving, and Learner Exploration.* Cognition and Instruction 7(4):323–342. DOI [10.1207/s1532690xci0704_3](https://doi.org/10.1207/s1532690xci0704_3) | T2 / ABS (recon., partly garbled) | Spreadsheet novices, 12 commands, test two days later. **Problem solving** took longer in training but gave faster and more successful test performance than **tutorials** (solutions typed in verbatim) or **exploration**. Exploration did not differ significantly from tutorials. | Garbled reconstruction; only this robust core is used. Old software. |
| L020 | Frese, Brodbeck, Heinbokel, Mooser, Schleiffenbaum, Thiemann (1991). *Errors in Training Computer Skills: On the Positive Function of Errors.* HCI 6(1):77–93. DOI [10.1207/s15327051hci0601_3](https://doi.org/10.1207/s15327051hci0601_3) | T2 / ABS (recon.) | Error training (n = 15) vs. error-free guidance (n = 9). Error group scored higher on non-speed tests. | Very small n. |
| L021 | Keith, Frese (2005). *Self-Regulation in Error Management Training: Emotion Control and Metacognition as Mediators of Performance Effects.* J. Applied Psychology 90(4):677–691. DOI [10.1037/0021-9010.90.4.677](https://doi.org/10.1037/0021-9010.90.4.677) | T2 / ABS (recon.) | 55 volunteer students learned "a computer program". Error management training (with or without a metacognitive module) gave better **transfer** than error-avoidant training, d = 0.75. The effect was mediated by emotion control and metacognitive activity. | Software not named in abstract. |
| L022 | Keith, Frese (2008). *Effectiveness of error management training: A meta-analysis.* J. Applied Psychology 93(1):59–69. DOI [10.1037/0021-9010.93.1.59](https://doi.org/10.1037/0021-9010.93.1.59) | T2 / ABS (recon.) | 24 studies, N = 2,183: mean d = 0.44. Post-training transfer d = 0.56 (larger than within-training performance). Adaptive transfer to structurally distinct tasks d = 0.80. Active exploration **and** explicit error encouragement were both identified elements. | Compares training methods, not any specific product. |
| L023 | Mathan, Koedinger (2005). *Fostering the Intelligent Novice: Learning From Errors With Metacognitive Tutoring.* Educ. Psychologist 40(4):257–265. DOI [10.1207/s15326985ep4004_7](https://doi.org/10.1207/s15326985ep4004_7) | T2 / ABS (recon., garbled) | Argues the "model of desired performance" matters more than feedback timing. Broadens the model to "some kinds of incorrect, but reasonable behaviors" so students practise error detection and correction. Reports deeper conceptual understanding, better transfer and retention. | Garbled abstract. Spreadsheet domain and the 74 % vs 60 % figures appear only in a search snippet (T3) and are **not used**. |
| L024 | VanLehn (2011). *The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems.* Educ. Psychologist 46(4):197–221. DOI [10.1080/00461520.2011.611369](https://doi.org/10.1080/00461520.2011.611369); abstract via [ASU portal](https://asu.elsevierpure.com/en/publications/the-relative-effectiveness-of-human-tutoring-intelligent-tutoring/) | T2 / ABS | Against no tutoring: human tutoring d = 0.79; step-based ITS d = 0.76 ("nearly as effective"). Contradicts earlier beliefs of 0.3 / 1.0 / 2.0. | The OpenAlex reconstruction attached the numbers to the wrong categories; the ASU portal text is used. These are about school/college ITS and **not** a prior for Practonaut. |
| L025 | Otto (1992). *UNDO, an aid for explorative learning?* J. Computer Science and Technology 7(3):226–236. DOI [10.1007/BF02946572](https://doi.org/10.1007/BF02946572) | T2 / META | Only bibliographic data verified. A search snippet (T3) says one-step undo "does not guarantee" successful exploratory learning of graphics editing. | Abstract not retrievable. **Do not cite as evidence**; it only marks the open question. |
| L026 | Shute (2008). *Focus on Formative Feedback.* RER 78(1). DOI [10.3102/0034654307313795](https://doi.org/10.3102/0034654307313795) | T2 / ABS (recon.) | Feedback types (verification, explanation, hints, worked examples) and timing. Effectiveness interacts with learner and task characteristics. | Review; guidelines only in full text. |
| L027 | Aleven, Roll, McLaren, Koedinger (2016). *Help Helps, But Only So Much: Research on Help Seeking with Intelligent Tutoring Systems.* IJAIED. DOI [10.1007/s40593-015-0089-1](https://doi.org/10.1007/s40593-015-0089-1) | T2 / ABS (recon.) | Feedback on help seeking changed how deliberately students used on-demand help, even after the feedback stopped, "but it did not lead to better" domain learning. The authors still recommend principle-based on-demand help. | Classroom math. |

### C. Evaluation design and ethics

| ID | Source | Tier / Read | Claim scope | Uncertainty |
|---|---|---|---|---|
| L028 | Leon, Davis, Kraemer. *The role and interpretation of pilot studies in clinical research.* J. Psychiatric Research (2010 per S2/OpenAlex). DOI [10.1016/j.jpsychires.2010.10.008](https://doi.org/10.1016/j.jpsychires.2010.10.008) | T2 / ABS | "A pilot study is not a hypothesis testing study." It "does not provide a meaningful effect size estimate for planning subsequent studies". Feasibility "do[es] not necessarily generalize beyond the inclusion and exclusion criteria". | Clinical context; the logic carries over, the specifics do not. |
| L029 | Julious (2005). *Sample size of 12 per group rule of thumb for a pilot study.* Pharmaceutical Statistics 4(4). DOI [10.1002/pst.185](https://doi.org/10.1002/pst.185) | T2 / ABS (recon.) | 12 per group for pilots without prior information, justified by feasibility and precision of mean/variance. | Clinical trials; a heuristic. |
| L030 | Lakens (2022). *Sample Size Justification.* Collabra: Psychology 8(1). DOI [10.1525/collabra.33267](https://doi.org/10.1525/collabra.33267) | T2 / ABS (recon.) | Six legitimate justifications, including resource constraints and "explicitly acknowledging the absence of justification". | — |
| L031 | Simmons, Nelson, Simonsohn (2011). *False-Positive Psychology.* Psychological Science. DOI [10.1177/0956797611417632](https://doi.org/10.1177/0956797611417632) | T2 / ABS | Flexibility in data collection, analysis and reporting "dramatically increases actual false-positive rates". | — |
| L032 | Nosek, Ebersole, DeHaven, Mellor (2018). *The preregistration revolution.* PNAS. DOI [10.1073/pnas.1708274114](https://doi.org/10.1073/pnas.1708274114) | T2 / ABS (recon.) | Define the questions and analysis plan before seeing the outcomes; this separates prediction from postdiction. | — |
| L033 | Nielsen, Landauer (1993). *A mathematical model of the finding of usability problems.* CHI '93. DOI [10.1145/169059.169166](https://doi.org/10.1145/169059.169166) | T2 / ABS (recon.) | Across 11 studies, **finding usability problems** follows a Poisson model. In one "medium" example the benefit/cost ratio peaks at four evaluators. | About finding problems, **not** estimating learning effects. Prevents misuse of "5 users is enough". |
| L034 | Koo, Li (2016). *A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research.* J. Chiropractic Medicine 15(2):155–163. DOI [10.1016/j.jcm.2016.02.012](https://doi.org/10.1016/j.jcm.2016.02.012) | T2 / ABS (recon.) | Ten ICC forms; report which one. Read on the 95 % CI: < 0.5 poor, 0.5–0.75 moderate, 0.75–0.9 good, > 0.9 excellent. | For continuous rubric scores. |
| L035 | McHugh (2012). *Interrater reliability: the kappa statistic.* Biochemia Medica 22(3):276–282. DOI [10.11613/BM.2012.031](https://doi.org/10.11613/BM.2012.031) | T2 / ABS (recon.) | Percent agreement ignores chance agreement; kappa corrects for it but has limits. Common thresholds may be too lenient. | For categorical pass/fail ratings. |
| L036 | WMA Declaration of Helsinki (amended Oct 2024). <https://www.wma.net/policies-post/wma-declaration-of-helsinki/> | T1 / DOC | Voluntary participation (§25). Plain-language information on aims, methods, risks, privacy provisions and incentives (§26). Right to refuse or withdraw "at any time without reprisal" (§26). Privacy and confidentiality (§24). | Written for **medical** research; used here only as a statement of general principles. Not legal advice. Belmont Report fetch failed (see §4). |

### D. Automatic result checkers, leakage and reward hacking

| ID | Source | Tier / Read | Claim scope | Uncertainty |
|---|---|---|---|---|
| L037 | Xie et al. (2024). *OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments.* arXiv [2404.07972](https://arxiv.org/abs/2404.07972) | T2 / ABS | 369 real-computer tasks, each with "a detailed initial state setup configuration and a custom execution-based evaluation script". Humans > 72 %, best model 12.24 %. | Scores are an April 2024 snapshot and outdated; the **method** (initial state + execution-based check) is what we use. |
| L038 | Zhu et al. (2025). *Establishing Best Practices for Building Rigorous Agentic Benchmarks.* arXiv [2507.02825](https://arxiv.org/abs/2507.02825) | T2 / ABS | Documented flaws: SWE-bench Verified with insufficient tests; TAU-bench counting **empty responses** as success. Misestimation "up to 100% in relative terms". The Agentic Benchmark Checklist cut overestimation on CVE-Bench by 33 %. | Preprint; numbers are benchmark-specific. |
| L039 | Von Arx, Chan, Barnes (2025-06-05). *Recent Frontier Models Are Reward Hacking.* METR. <https://metr.org/blog/2025-06-05-recent-reward-hacking/> | T2 (research org) / DOC | o3 cases: walked the call stack to read the grader's precomputed answer (6/24 runs); monkey-patched the evaluation function to pass every submission (12/28); copied cached fine-tuned weights (21/21). RE-Bench 39/128 runs, HCAST 8/1,087. Detection has "very high false-positive rate"; the counts may be "a significant underestimate". | Model- and task-specific snapshot. |
| L040 | Zhong, Raghunathan, Carlini (2025). *ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases.* arXiv [2510.20270](https://arxiv.org/abs/2510.20270) | T2 / ABS | Task variants where specification and tests conflict, so any pass means cheating. Observed behaviors range from test modification to operator overloading; the work also covers monitoring. | Cheating rates not read here. |
| L041 | SWE-bench issue #465 *Repo State Loopholes During Agentic Evaluation* (opened 2025-09-03, closed 2026-03-24). <https://github.com/SWE-bench/SWE-bench/issues/465> (via `api.github.com`) | T1 / DOC | Agents read future repository state, for example `git log --all`, which exposed the fixing commit. Mitigation: remove origins, all branches and the reflog. Leakage seen in trajectories of several named models. | Count of affected runs not stated. Whether fixed images shipped was not verified. Press figures on pass shares (T3) **not used**. |
| L042 | Kaufman, Rosset, Perlich, Stitelman (2012). *Leakage in data mining: Formulation, detection, and avoidance.* ACM TKDD. DOI [10.1145/2382577.2382579](https://doi.org/10.1145/2382577.2382579) | T2 / ABS (recon.) | Leakage is information about the target that "should not be legitimately available". Remedies: data management and **learn-predict separation**; detection when the data source is not under your control. | Machine-learning setting; the principle carries over. |

### E. Accessibility of interactive work surfaces

| ID | Source | Tier / Read | Claim scope | Uncertainty |
|---|---|---|---|---|
| L043 | W3C, *WCAG 2.2* (Recommendation, document dated 12 Dec 2024) <https://www.w3.org/TR/WCAG22/>; Understanding pages for [2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | T1 / DOC | 2.5.7 Dragging Movements (AA): dragging functions need a single-pointer alternative unless dragging is essential. 2.1.1 Keyboard (A): everything keyboard-operable, **except** input that depends on the path of movement, not just its endpoints. 2.1.2 No Keyboard Trap (A). 2.4.7 Focus Visible (AA). 2.4.11 Focus Not Obscured (AA): the focused component is not *entirely* hidden by author content. 4.1.3 Status Messages (AA): results, errors and progress must reach assistive technology "without receiving focus". 2.2.1 Timing Adjustable (A). | Texts of 2.5.8, 3.3.1, 3.3.3, 3.3.4 were not returned and are not quoted. First publication date of 2.2 not re-verified. |

## 2. What the sources mean for each question

**Authoring (Q1).** A demonstration in CTAT gives one **path**. Correctness comes from the
author's generalization: added paths, groups, formulas, incorrect-action links (L001, L002).
SimStudent, Apprentice Learner and AI2T learn production rules from demonstrations *plus*
correctness feedback; negative feedback is what made models accurate (L003, L004, L006). The
lesson for Practonaut is direct: **demonstrations alone under-determine the rule.** Hypotheses
must be confirmed by observing the app's states. Errors are modelled as explicit, annotated
incorrect actions, not inferred. Two things CTAT does not do, per these sources: it does not
learn **application state semantics** from a third-party app, and it does not judge results on
an **exported artifact** with a separate checker. Its correctness test is the step check inside
the tutor. This is where Practonaut can differ. The claim "nobody has done this" is not supported;
the separate prior-art register owns that question.

**Learning by doing and transfer (Q2).** In software training, outcomes favor **active, guided
practice with error handling** over typed-in tutorials (L018, L019, L022) and over unguided
exploration (L019). Explicit error encouragement plus exploration shows the largest effects on
**transfer**, especially to structurally different tasks (L022). Worked examples and fading suit
novices; support should fade as expertise grows (L011, L012). Productive failure has
meta-analytic support for conceptual learning, but not for young learners or domain-general skills
(L014). It says nothing directly about procedural software skill. Delayed tests can reverse
immediate results, and learner confidence can mislead (L015). "Far transfer" is not one thing and
has no single effect size (L017).

**Evaluation (Q3).** Small pilots exist to test feasibility. They do not estimate effects and do
not generalize beyond their inclusion criteria (L028, L029). A resource-limited n is a legitimate,
declared justification (L030). Fix the analysis in advance (L031, L032). "Five users" comes from
usability problem discovery, not effect estimation (L033). Rubrics need agreement statistics
chosen for the data type (L034, L035); with n ≈ 10 those statistics are themselves imprecise.

**Checkers (Q4).** Execution-based checks on a defined initial state are the established
benchmark method (L037). Every documented failure attacked the boundary between agent and
checker: empty output scored as success (L038), grader patched or its answer read (L039), tests
rewritten (L040), solution read from history (L041). Leakage is a separation problem (L042).

**Feedback and accessibility (Q5).** Feedback works through its type and timing and interacts
with the learner (L026). On-demand help changes help-seeking behavior more readily than domain
learning (L027). Undo as a learning mechanism lacks direct evidence in what was retrieved (L025).
Treat it as a **safety net that makes error encouragement acceptable** (L021, L022), not as a
proven learning lever. For canvas-like work surfaces, the hard WCAG points are: drag-only
operations (2.5.7), full keyboard operation (2.1.1; only freehand paths are exempt), visible and
unobscured focus with floating panels (2.4.7, 2.4.11), and feedback announced without moving focus
(4.1.3) (L043).

## 3. Derivations for Practonaut

### (a) What the world format needs for the learning mechanics

1. **Goal predicates over end state, never paths** (glossary *Goal predicate*). Any end state that
   satisfies the predicate passes. Process constraints only when the skill *is* the process (for
   example "uses a component"). This avoids the path explosion that limits example-tracing (L001).
2. **Demonstrated paths are examples, not the spec.** Store them for hints and worked examples.
   Mark each with provenance; never use them as the acceptance criterion.
3. **Typed error classes per task**: `rejected_by_app`, `accepted_but_violates_goal`,
   `suboptimal`, `unmodeled`. Each modelled error carries a *consequence explanation* tied to the
   observed state change, like CTAT incorrect-action links (L001, L002) but grounded in confirmed
   rules. Unmodeled stays unmodeled.
4. **Hint ladder** per task: principle → specific next step → bottom-out demonstration, with a
   logged level per request. Hint use is recorded as a covariate, not counted as learning (L027).
5. **Pedagogy mode as a world setting**: `worked_example` → `faded` (steps removed in order) →
   `independent`. Optional error-management instruction ("errors are expected; use them") (L011,
   L012, L021, L022). Default progression stays declarative; no adaptivity claims without data.
6. **Variant templates with seeds** (like Mass Production, L002). Variants vary surface and
   structure (L010, L017). Each variant is checked solvable. Held-out variants are generated from a
   separate template set never shipped to the player or the agent surface.
7. **Undo/Reset as exact state operations** (glossary). Pair reset with a short reflection prompt
   after an error (the metacognition mediator, L021). Never present undo itself as the learning
   effect (L025).
8. **Accessibility contract in the action schema**: every action reachable without dragging and by
   keyboard; feedback emitted as status messages (live region); no hard time limits in practice
   mode (L043).

### (b) Evaluator rules against leakage and gaming

1. **Learn-check separation (L042).** Held-out tasks, their goal predicates and checker code live
   outside every world package and outside the agent surface (spike S4c). Separate hash manifest.
2. **Check the exported artifact out of process.** Use an independent parser; never trust the
   runtime's own "done" flag. The agent or learner workspace has no write access to the checker,
   its config or its dependencies (L039).
3. **No solution channels in start states.** Strip undo or version history, recent files,
   metadata and anything derived from the solution by reversal (L041). Generate start states
   forward from a seed.
4. **Mandatory negative controls before any run counts.** Empty submission, untouched start state,
   corrupted export and a known-wrong artifact must all fail (L038). For agents, add impossible
   variants (spec conflicts with predicate); any pass there is cheating (L040).
5. **Validate the checker on human-made solutions.** Run it on several *different* valid
   solutions and on known-invalid ones; report false-pass and false-fail counts. A checker that
   rejects a valid alternative is a defect (L001: solution spaces branch).
6. **Exposure log and retirement.** Every held-out task is versioned and hashed in the
   preregistration. Any appearance in authoring, prompts, hints or training data retires it.
7. **Feedback must not reveal held-out predicates.** In-world feedback uses only the predicates of
   the current practice task.
8. **Report four claim classes separately:** authoring synthesis (does the world reproduce the
   demonstration?), runtime correctness (conformance against the real app), agent success
   (held-out, real app), human transfer (held-out, real app, people). None implies another.

### (c) Preregistrable protocol template: first exploratory transfer probe

> Template. Bracketed values are **design assumptions** to fix before execution, not
> source-derived. Freeze it like `spikes/PREREGISTRATION.md` before recruiting anyone.

- **Question:** Do adults new to [workflow W] in [app, pinned version] complete held-out transfer
  cases in the real app after a Practonaut world session at least as often as after a standard
  tutorial of equal length? Also: is the procedure feasible?
- **Status:** exploratory feasibility probe (L028). No confirmatory hypothesis test.
- **Participants:** voluntary adults; [n = 8 or 12, a multiple of 4]; inclusion: no prior use of W
  (screening question + baseline). Justification: resource-constrained (L030). n is fixed in
  advance; no adding participants after looking at results (L031).
- **Design (assumption):** within-subject crossover over two comparable task families A and B,
  counterbalanced on two factors: which family gets which condition, and the order. Alternative:
  between-subject, randomized and stratified by baseline.
- **Conditions:** (1) Practonaut world: worked example → faded → independent, with error
  encouragement, hints and reset. (2) Standard tutorial: [the vendor's official tutorial or a
  written step-by-step guide] on the same content. Same time budget, [25 min] each.
- **Baseline:** one held-out case per family in the real app *before* training,
  [10 min] limit.
- **Outcome tasks:** per family, [2] held-out transfer cases in the real app: one near (same
  structure, new surface) and one structurally different (L017, L022). Never shown in any
  condition. Hashes are recorded in the preregistration. Optional delayed retest at
  [+3 to +7 days] (L015).
- **Primary outcome:** pass/fail per case, meaning all *must* goal predicates hold on the exported
  artifact. Decided by the independent checker within [10 min]. **Secondary outcomes:** time to pass,
  number of help lookups, partial predicates, self-rated confidence (reported separately, L015).
  Rubric items the checker cannot judge are scored by two raters blind to condition; report
  agreement (L034, L035) with the caveat of small n.
- **Checker readiness gate (before participant 1):** rules (b)4 and (b)5 pass; checker results
  agree with two humans on [all] pilot artifacts.
- **Analysis (fixed):** a per-participant table; pass counts per condition with exact or Wilson
  intervals; paired discordant counts for the crossover. No subgroup analyses. No effect size
  reported as an estimate.
- **Feasibility success criteria:** [≥ 80 %] of sessions completed; checker–human disagreement
  [0] on primary outcomes; time budget kept in [≥ 90 %] of sessions; no held-out leak.
- **Stopping rules:** a participant may stop at any time without giving a reason. Pause the study
  if a checker false pass or false fail is found: fix it, re-check all stored artifacts with the
  corrected checker, report both results. Retire a task if leaked and exclude it as planned in
  advance. Stop and redesign tasks if [≥ 3 of the first 4] pass the baseline (ceiling) or
  [0 of the first 4] pass any post case in either condition (floor); these runs are reported, not
  pooled.
- **Ethics (principles only, not legal advice):** voluntary participation; plain-language
  information on aims, procedure, data collected and any incentive; withdrawal without
  consequences; record the minimum (artifacts, timings, app/world logs); pseudonymize; no screen
  or audio recording unless separately agreed; deletion on request. Data-protection obligations
  are checked separately before recruitment (L036).
- **Report:** every session including failures and stops; the raw artifacts' hashes; deviations
  with dates.

### (d) What Practonaut must not claim without real participants

1. That people **learn**, learn **faster**, or **transfer** skills: human transfer stays UNKNOWN
   until a transfer case with people is run, and an n ≈ 5–12 probe only gives feasibility and a
   direction (L028).
2. Any **effect size**, including borrowed ones. ITS (L024), error management training (L022) or
   productive failure (L014) figures describe *other* interventions and populations.
3. That **agent success** in a world, or world fidelity to the app, implies human learning. These
   are separate claim classes ((b)8).
4. That error encouragement, fading or undo "work" in Practonaut. The literature supports these
   as design rationale, not as results of this product.
5. "Equivalent to a tutorial" from a non-significant difference in a small sample.
6. "Accessible" or "WCAG 2.2 AA conformant" without an audit of the actual player (L043).
7. Better authoring than CTAT or AI2T. No comparison has been run; they solve a neighboring
   problem (L001–L009).

## 4. Failed or partial retrievals

- Aleven, McLaren, Sewall, Koedinger (2009), IJAIED 19(2) "A New Paradigm …": Pressbooks copy 403;
  `pact.cs.cmu.edu` PDF expired TLS certificate. Bibliographic data only (T3 snippet). Not used.
- Springer full text of L001: login redirect (303). The author manuscript from `cs.cmu.edu` was used.
- Belmont Report: `hhs.gov` 403, NIH mirror 404. L036 used instead.
- Abstracts withheld in Semantic Scholar for L001, L010, L022, L023, L024; OpenAlex or the ASU
  portal were used. VanLehn's OpenAlex reconstruction was wrong and was discarded.
- Otto 1992 (L025): no abstract anywhere reachable.
- Not retrieved, deliberately not cited: Bjork "desirable difficulties", van der Meij & Carroll
  minimalism principles, Hattie & Timperley, WCAG 2.5.8 / 3.3.x texts.

## 5. Recheck before reuse

TutorGym model results (L009), OSWorld scores (L037), METR rates (L039), SWE-bench mitigation
status (L041) and CTAT repository state (L002) are snapshots from 2026-10-03.
