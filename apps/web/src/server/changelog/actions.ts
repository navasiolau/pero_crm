'use server';

import type {JournalScope} from './contract';
import type {JournalQueryInput} from './query-contract';
import {queryJournal,queryJournalEntry,queryJournalFilterOptions} from './queries';

export async function listJournal(input:JournalQueryInput={}){return queryJournal(input);}
export async function getJournalEntry(id:string,scope:JournalScope={kind:'global'}){return queryJournalEntry(id,scope);}
export async function listJournalFilterOptions(scope:JournalScope={kind:'global'}){return queryJournalFilterOptions(scope);}
