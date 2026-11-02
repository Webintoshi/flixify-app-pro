# Android TV catalog speed implementation

Spec: docs/superpowers/specs/2026-11-02-tv-catalog-speed-design.md

BASEab8d3e8bbf8173733202f560547c5bea384c4dcc. Existingdedicatedcheckout. RootownsGradle/emulator/version/APKpublicmetadata/Git/publication. Disjointimplementationownership, no syncedsourceschanges. Allnewbehavior mustretain1.4.9renewal andprivacy/access safeguards.

Task1 — presentation: owner renderagent, MainActivity/CatalogShowcase/CatalogFilterData plus focusednewpreparer/model/unit tests. Reproduce existingmainblock via savedfixture, addfailingresponsivenesscases, boundedasyncpurepresentation andcache; optimizeemptyLivefilter/regex withoutsemanticdrift; lifecycle/source/account/trim tests. NoNetworkTvRepository changes.

Task2 — repository: owner ioagent, NetworkTvRepository and focuseddata tests. Validate duplicateHome/tab anddoubleprojection with in-memoryfixture/latch RED, thenminimalsharedpreparedrequest/projection fix. Account/auth andcached pages remainusable whilecoldproviderbusy. Preserveforce,source,tokenrotation,trim,policy andplayback guards. NoUI/formattingclasseschanges.

Task3 — performancefixture: ownCatalogPerformanceTest only. PreservebeforeJSON, failbudgetonbaseline, asyncwaitcorrectsurfaceafterfix;29k rows, cold+warmtimings, UI500msbudget, boundedholders/repeatednavigation/trim andheap diagnostics. RootrunsallGradle/devicecalls.

Task4 — root acceptance/delivery: independentlyreviewscopes; finalunit/UI/perf/lint/release onexactfrozencode; verify samecertAPK1.4.10/code18,min23, metadata/oldfiles. Neutralcommit/push. Publishwhenactualhostaccess available withguardedcurrentbaselineandretainedproducts; verifypublicfullhash/manifest/link. Ifaccessremainsblocked,deliveracceptedAPK andexplicitpublicationstatus. No repeatedunchangedchecks orrealplayback/charges.
