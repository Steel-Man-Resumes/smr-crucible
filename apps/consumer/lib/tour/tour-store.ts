/** The tour's store wired to the real database: every statement runs as the user (RLS). */
import { queryAsUser, runAsUser, invalidateNextStep } from '@crucible/core';
import { createTourStore, type TourDb } from './tour-sql';

export const tourDb: TourDb = {
  asUser: (userId, text, params) => queryAsUser(userId, text, params),
  batchAsUser: (userId, build) => runAsUser<unknown[][]>(userId, build as never),
  invalidate: userId => invalidateNextStep(userId),
};
export const tourStore = createTourStore(tourDb);
