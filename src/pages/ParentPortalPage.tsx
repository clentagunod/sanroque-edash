import { FormEvent, useEffect, useState } from 'react';
import { auth, getPublicStats } from '../lib/firebase';
import { forceLoginPageLightTheme } from '../lib/auth';
import { fsGetLearner } from '../lib/firestore-api';
import '../styles/pages/parent-portal.css';

type Learner = Record<string, any>;

const LABELS: Record<string, string> = {
  learnerId: 'LRN', firstName: 'First name', middleName: 'Middle name', lastName: 'Last name',
  birthDate: 'Birthdate', age: 'Age', gradeLevel: 'Grade level', section: 'Section', gender: 'Gender',
  guardian: 'Parent / guardian', contact: 'Contact number', enrollmentStatus: 'Enrollment status',
  eosyStatus: 'End-of-year status', dateAdded: 'Date added', bosyHeight: 'BOSY height', bosyWeight: 'BOSY weight',
  bosyNutritionalStatus: 'BOSY nutritional status', mosyHeight: 'MOSY height', mosyWeight: 'MOSY weight',
  mosyNutritionalStatus: 'MOSY nutritional status', eosyHeight: 'EOSY height', eosyWeight: 'EOSY weight',
  eosyNutritionalStatus: 'EOSY nutritional status', transferType: 'Transfer type', transferSchool: 'Transfer school',
  transferDate: 'Transfer date', transferReason: 'Transfer reason', transferNotes: 'Transfer notes',
};

const PROFILE_FIELDS = ['firstName', 'middleName', 'lastName', 'birthDate', 'age', 'gradeLevel', 'section', 'gender'];
const FAMILY_FIELDS = ['guardian', 'contact'];
const SCHOOL_FIELDS = ['enrollmentStatus', 'eosyStatus', 'dateAdded'];
const NUTRITION_FIELDS = [
  'bosyHeight', 'bosyWeight', 'bosyNutritionalStatus', 'mosyHeight', 'mosyWeight', 'mosyNutritionalStatus',
  'eosyHeight', 'eosyWeight', 'eosyNutritionalStatus',
];
const TRANSFER_FIELDS = ['transferType', 'transferSchool', 'transferDate', 'transferReason', 'transferNotes'];
const PROGRAM_FIELDS = [
  ['is4Ps', '4Ps beneficiary'], ['isIP', 'IP learner'], ['isSNED', 'SNED learner'],
  ['isARAL', 'ARAL tagged'], ['isMuslim', 'Muslim learner'],
];

function formatValue(key: string, value: any) {
  if (value && typeof value.toDate === 'function') return value.toDate().toLocaleDateString();
  if (key === 'dateAdded' && value) return new Date(value).toLocaleDateString();
  if (key === 'enrollmentStatus') return String(value).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return String(value);
}

function DetailSection({ title, fields, learner }: { title: string; fields: string[]; learner: Learner }) {
  const visibleFields = fields.filter((field) => learner[field] !== undefined && learner[field] !== null && learner[field] !== '');
  if (!visibleFields.length) return null;
  return (
    <section className="parent-detail-section">
      <h2>{title}</h2>
      <dl className="parent-detail-grid">
        {visibleFields.map((field) => <div key={field}><dt>{LABELS[field] || field}</dt><dd>{formatValue(field, learner[field])}</dd></div>)}
      </dl>
    </section>
  );
}

export default function ParentPortalPage() {
  const [learnerId, setLearnerId] = useState('');
  const [learner, setLearner] = useState<Learner | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [schoolYear, setSchoolYear] = useState('');

  useEffect(() => {
    document.title = 'Parent Portal - San Roque Elementary School';
    forceLoginPageLightTheme();
    getPublicStats().then((stats) => setSchoolYear(String(stats?.schoolYear || ''))).catch(() => {});
    return () => {
      if (auth.currentUser?.isAnonymous) void auth.signOut();
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedId = learnerId.trim();
    setLearner(null);
    setMessage('');
    if (!normalizedId) {
      setMessage('Enter the learner reference number to continue.');
      return;
    }
    if (!schoolYear) {
      setMessage('The current school year is unavailable right now. Please try again shortly.');
      return;
    }
    setLoading(true);
    try {
      if (!auth.currentUser) {
        await auth.signInAnonymously();
      }
      const result = await fsGetLearner(normalizedId, schoolYear);
      if (!result) setMessage('No active learner record was found for that LRN. Check the number and try again.');
      else setLearner(result);
    } catch (error: any) {
      setMessage(error?.code === 'permission-denied'
        ? 'This lookup is not available yet. Please contact the school office.'
        : 'We could not complete the lookup. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="parent-portal-shell">
      <header className="parent-portal-header">
        <a className="parent-portal-brand" href="index.html" aria-label="Back to login">
          <span className="parent-portal-brand-mark">SR</span>
          <span><strong>San Roque ES</strong><small>Parent information portal</small></span>
        </a>
        <a className="parent-portal-back" href="index.html">Back to sign in</a>
      </header>
      <div className="parent-portal-content">
        <section className="parent-portal-intro">
          <span className="parent-portal-kicker">Read-only access</span>
          <h1>Find your child&apos;s school record.</h1>
          <p>Enter the learner reference number provided by San Roque Elementary School to view the latest available information.</p>
        </section>
        <form className="parent-search-card" onSubmit={handleSubmit}>
          <label htmlFor="parentLearnerId">Learner reference number</label>
          <div className="parent-search-row">
            <input id="parentLearnerId" value={learnerId} onChange={(event) => setLearnerId(event.target.value)} placeholder="Enter LRN" autoComplete="off" inputMode="numeric" />
            <button type="submit" disabled={loading}>{loading ? 'Searching...' : 'Search record'}</button>
          </div>
          <p className="parent-search-note">Information is displayed for viewing only. Nothing can be edited from this portal.</p>
          {message && <p className="parent-portal-message" role="alert">{message}</p>}
        </form>
        {learner && (
          <section className="parent-result" aria-live="polite">
            <div className="parent-result-heading">
              <div><span className="parent-portal-kicker">Learner record</span><h2>{[learner.firstName, learner.middleName, learner.lastName].filter(Boolean).join(' ')}</h2><p>{learner.learnerId} {schoolYear ? `• ${schoolYear}` : ''}</p></div>
              <span className="parent-readonly-badge">Read only</span>
            </div>
            <div className="parent-programs">
              {PROGRAM_FIELDS.filter(([field]) => learner[field]).map(([, label]) => <span key={label}>{label}</span>)}
              {!PROGRAM_FIELDS.some(([field]) => learner[field]) && <span>Not tagged in a program</span>}
            </div>
            <DetailSection title="Learner profile" fields={PROFILE_FIELDS} learner={learner} />
            <DetailSection title="Parent or guardian" fields={FAMILY_FIELDS} learner={learner} />
            <DetailSection title="School record" fields={SCHOOL_FIELDS} learner={learner} />
            <DetailSection title="Nutrition record" fields={NUTRITION_FIELDS} learner={learner} />
            <DetailSection title="Transfer information" fields={TRANSFER_FIELDS} learner={learner} />
            {learner.extra && Object.keys(learner.extra).length > 0 && <DetailSection title="Additional information" fields={Object.keys(learner.extra)} learner={learner.extra} />}
          </section>
        )}
      </div>
      <footer className="parent-portal-footer">San Roque Elementary School · Parent information portal</footer>
    </main>
  );
}