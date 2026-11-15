/** The English half of the server-text list, merged: loaded on demand by the provider (Spanish only). */
import enApi from "./en/server-text-api.json";
import enFinish from "./en/server-text-finish.json";
import enProgress from "./en/server-text-progress.json";
import enPlans from "./en/server-text-plans.json";
import enJobs from "./en/server-text-jobs.json";
import enHelp from "./en/server-text-help.json";
import enExtras from "./en/server-text-extras.json";
import enRecordcheck from "./en/server-text-recordcheck.json";

export default { ...enApi, ...enFinish, ...enProgress, ...enPlans, ...enJobs, ...enHelp, ...enExtras, ...enRecordcheck } as Record<string, string>;
