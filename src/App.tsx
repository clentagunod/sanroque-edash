import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ParentPortalPage from './pages/ParentPortalPage';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import RouteLoadingFallback from './components/RouteLoadingFallback';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MasterlistPage = lazy(() => import('./pages/MasterlistPage'));
const Program4psPage = lazy(() => import('./pages/Program4psPage'));
const ProgramIpPage = lazy(() => import('./pages/ProgramIpPage'));
const ProgramSnedPage = lazy(() => import('./pages/ProgramSnedPage'));
const ProgramAralPage = lazy(() => import('./pages/ProgramAralPage'));
const ProgramMuslimPage = lazy(() => import('./pages/ProgramMuslimPage'));
const EnrollmentDataPage = lazy(() => import('./pages/EnrollmentDataPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const EosyReportPage = lazy(() => import('./pages/EosyReportPage'));
const GradesProfilePage = lazy(() => import('./pages/GradesProfilePage'));
const ReadingProfilePage = lazy(() => import('./pages/ReadingProfilePage'));
const MathProfilePage = lazy(() => import('./pages/MathProfilePage'));
const NutritionalStatusPage = lazy(() => import('./pages/NutritionalStatusPage'));
const TransferInfoPage = lazy(() => import('./pages/TransferInfoPage'));
const DropoutPage = lazy(() => import('./pages/DropoutPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const UtilitiesPage = lazy(() => import('./pages/UtilitiesPage'));
const BmiCalculatorPage = lazy(() => import('./pages/BmiCalculatorPage'));
const GradeCalculatorPage = lazy(() => import('./pages/GradeCalculatorPage'));
const ManageUsersPage = lazy(() => import('./pages/ManageUsersPage'));
const EduaiPage = lazy(() => import('./pages/EduaiPage'));

/**
 * Route paths intentionally mirror the legacy site's file layout
 * ("/pages/dashboard.html", "/pages/masterlist.html", ...) so every
 * hard-coded <a href="masterlist.html"> inside the ported markup
 * (see src/pages/markup/*.html) keeps working completely unmodified —
 * relative links resolve to these exact paths. See
 * README.md for the architecture overview.
 */
export default function App() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/index.html" element={<LoginPage />} />
          <Route path="/parent.html" element={<ParentPortalPage />} />

          <Route path="/pages/dashboard.html" element={<DashboardPage />} />
          <Route path="/pages/masterlist.html" element={<MasterlistPage />} />
          <Route path="/pages/program-4ps.html" element={<Program4psPage />} />
          <Route path="/pages/program-ip.html" element={<ProgramIpPage />} />
          <Route path="/pages/program-sned.html" element={<ProgramSnedPage />} />
          <Route path="/pages/program-aral.html" element={<ProgramAralPage />} />
          <Route path="/pages/program-muslim.html" element={<ProgramMuslimPage />} />
          <Route path="/pages/enrollment-data.html" element={<EnrollmentDataPage />} />
          <Route path="/pages/data.html" element={<DataPage />} />
          <Route path="/pages/reports.html" element={<ReportsPage />} />
          <Route path="/pages/eosy-report.html" element={<EosyReportPage />} />
          <Route path="/pages/grades-profile.html" element={<GradesProfilePage />} />
          <Route path="/pages/reading-profile.html" element={<ReadingProfilePage />} />
          <Route path="/pages/math-profile.html" element={<MathProfilePage />} />
          <Route path="/pages/nutritional-status.html" element={<NutritionalStatusPage />} />
          <Route path="/pages/transfer-info.html" element={<TransferInfoPage />} />
          <Route path="/pages/dropout.html" element={<DropoutPage />} />
          <Route path="/pages/audit-log.html" element={<AuditLogPage />} />
          <Route path="/pages/feedback.html" element={<FeedbackPage />} />
          <Route path="/pages/utilities.html" element={<UtilitiesPage />} />
          <Route path="/pages/bmi-calculator.html" element={<BmiCalculatorPage />} />
          <Route path="/pages/grade-calculator.html" element={<GradeCalculatorPage />} />
          <Route path="/pages/manage-users.html" element={<ManageUsersPage />} />
          <Route path="/pages/eduai.html" element={<EduaiPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
