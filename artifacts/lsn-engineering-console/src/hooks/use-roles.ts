import { useAuth } from '@/contexts/AuthContext';
import { CanonicalRole } from '@/lib/auth-api';

export function useRoles() {
  const { user } = useAuth();
  
  const isSuperadmin = user?.role === 'SUPERADMIN';
  const isFirmwareAdmin = isSuperadmin || user?.role === 'FIRMWARE_ADMIN';
  const isClientReviewer = user?.role === 'CLIENT_REVIEWER';
  
  return {
    role: user?.role as CanonicalRole,
    isSuperadmin,
    isFirmwareAdmin,
    isClientReviewer,
  };
}