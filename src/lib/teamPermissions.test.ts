import { describe, expect, it } from 'vitest'
import {
  acceptedTeamRole,
  canClaimPlayerGuardianship,
  canChangeTeamMemberRole,
  canCorrectStats,
  canDeleteGame,
  canDeleteTeam,
  canEditPlayerIdentity,
  canInviteTeamRole,
  canLeaveTeam,
  canManageRoster,
  canRemoveTeamMember,
  canTrackGames,
  canViewPlayerGuardians,
  parseTeamRole,
} from './teamPermissions'

describe('teamPermissions', () => {
  it('parses only current team roles and requires accepted membership', () => {
    expect(parseTeamRole('owner')).toBe('owner')
    expect(parseTeamRole('viewer')).toBe('viewer')
    expect(parseTeamRole(null)).toBeNull()
    expect(acceptedTeamRole('scorer', '2026-07-15T12:00:00Z')).toBe('scorer')
    expect(acceptedTeamRole('admin', null)).toBeNull()
  })

  it('keeps viewer access read-only while tracking roles can record', () => {
    expect(canTrackGames('owner')).toBe(true)
    expect(canTrackGames('admin')).toBe(true)
    expect(canTrackGames('scorer')).toBe(true)
    expect(canTrackGames('viewer')).toBe(false)
    expect(canTrackGames(null)).toBe(false)
  })

  it('limits team management and corrections to owner/admin', () => {
    expect(canManageRoster('owner')).toBe(true)
    expect(canManageRoster('admin')).toBe(true)
    expect(canManageRoster('scorer')).toBe(false)
    expect(canManageRoster('viewer')).toBe(false)
    expect(canCorrectStats('admin')).toBe(true)
    expect(canCorrectStats('scorer')).toBe(false)
  })

  it('keeps team deletion owner-only and game deletion owner/admin', () => {
    expect(canDeleteTeam('owner')).toBe(true)
    expect(canDeleteTeam('admin')).toBe(false)
    expect(canDeleteGame('owner')).toBe(true)
    expect(canDeleteGame('admin')).toBe(true)
    expect(canDeleteGame('scorer')).toBe(false)
    expect(canDeleteGame('viewer')).toBe(false)
  })

  it('enforces invite hierarchy', () => {
    expect(canInviteTeamRole('owner', 'admin')).toBe(true)
    expect(canInviteTeamRole('owner', 'scorer')).toBe(true)
    expect(canInviteTeamRole('owner', 'viewer')).toBe(true)
    expect(canInviteTeamRole('admin', 'scorer')).toBe(true)
    expect(canInviteTeamRole('admin', 'viewer')).toBe(true)
    expect(canInviteTeamRole('admin', 'admin')).toBe(false)
    expect(canInviteTeamRole('scorer', 'scorer')).toBe(false)
    expect(canInviteTeamRole('viewer', 'viewer')).toBe(false)
    expect(canInviteTeamRole('owner', 'owner')).toBe(false)
  })

  it('allows accepted non-owners to leave', () => {
    expect(canLeaveTeam('owner')).toBe(false)
    expect(canLeaveTeam('admin')).toBe(true)
    expect(canLeaveTeam('scorer')).toBe(true)
    expect(canLeaveTeam('viewer')).toBe(true)
    expect(canLeaveTeam(null)).toBe(false)
  })

  it('protects owner/admin targets from admin removal', () => {
    expect(canRemoveTeamMember('owner', 'admin', false)).toBe(true)
    expect(canRemoveTeamMember('admin', 'scorer', false)).toBe(true)
    expect(canRemoveTeamMember('admin', 'viewer', false)).toBe(true)
    expect(canRemoveTeamMember('admin', 'admin', false)).toBe(false)
    expect(canRemoveTeamMember('owner', 'owner', false)).toBe(false)
    expect(canRemoveTeamMember('owner', 'scorer', true)).toBe(false)
  })

  it('allows owners to assign non-owner roles and admins to switch scorer/viewer', () => {
    expect(canChangeTeamMemberRole('owner', 'scorer', 'admin')).toBe(true)
    expect(canChangeTeamMemberRole('owner', 'admin', 'scorer')).toBe(true)
    expect(canChangeTeamMemberRole('owner', 'viewer', 'admin')).toBe(true)
    expect(canChangeTeamMemberRole('admin', 'scorer', 'viewer')).toBe(true)
    expect(canChangeTeamMemberRole('admin', 'viewer', 'scorer')).toBe(true)
    expect(canChangeTeamMemberRole('admin', 'scorer', 'admin')).toBe(false)
    expect(canChangeTeamMemberRole('owner', 'owner', 'admin')).toBe(false)
  })

  it('defers self-service guardianship for viewers', () => {
    expect(canClaimPlayerGuardianship('owner')).toBe(true)
    expect(canClaimPlayerGuardianship('admin')).toBe(true)
    expect(canClaimPlayerGuardianship('scorer')).toBe(true)
    expect(canClaimPlayerGuardianship('viewer')).toBe(false)
    expect(canClaimPlayerGuardianship(null)).toBe(false)
  })

  it('keeps player identity rights separate from team role', () => {
    expect(canEditPlayerIdentity('user-1', 'user-1', false)).toBe(true)
    expect(canEditPlayerIdentity('user-1', 'user-2', true)).toBe(true)
    expect(canEditPlayerIdentity('user-1', 'user-2', false)).toBe(false)
    expect(canEditPlayerIdentity(null, 'user-1', true)).toBe(false)
  })

  it('shows guardian management through team authority or a player relationship', () => {
    expect(canViewPlayerGuardians('owner', false, false)).toBe(true)
    expect(canViewPlayerGuardians('admin', false, false)).toBe(true)
    expect(canViewPlayerGuardians('scorer', false, false)).toBe(false)
    expect(canViewPlayerGuardians('scorer', false, true)).toBe(true)
    expect(canViewPlayerGuardians('viewer', true, false)).toBe(true)
    expect(canViewPlayerGuardians('viewer', false, false)).toBe(false)
  })
})
