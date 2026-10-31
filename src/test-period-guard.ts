import {NoWriteError} from './test-drafts.js';
import * as z from 'zod/v4';
export function assertBookingDateOpen(organization:any,entryDate:string){
 z.iso.date().parse(entryDate);
 if(organization.isLocked===true)throw new NoWriteError('Organization is locked; no booking performed');
 const lockedThrough=organization.fiscalLockingDate;
 if(lockedThrough!=null){z.iso.date().parse(lockedThrough);if(entryDate<=lockedThrough)throw new NoWriteError('Entry date is within fiscal lock; no booking performed');}
}

export function assertVatPeriodsOpen(periods:any[],organizationId:string,entryDate:string){
 z.iso.date().parse(entryDate);
 for(const period of periods){
  if(period.organizationId!==organizationId)throw new NoWriteError('Unexpected VAT period ownership');
  z.iso.date().parse(period.startDate);z.iso.date().parse(period.endDate);
  if(period.startDate>period.endDate||typeof period.isSettled!=='boolean')throw new NoWriteError('Invalid VAT period state');
  if(period.startDate<=entryDate&&entryDate<=period.endDate&&period.isSettled)throw new NoWriteError('VAT period is settled; explicitly review and reopen it before booking');
 }
}
