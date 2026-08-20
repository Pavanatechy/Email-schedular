import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../pages/Login';
import { Dashboard } from '../pages/Dashboard';
import { Compose } from '../pages/Compose';
import { useAuth } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { emailService } from '../services/email.service';

// Mock Lucide icons to prevent rendering failures
vi.mock('lucide-react', () => {
  return {
    Mail: () => <span data-testid="mail-icon">Mail</span>,
    LayoutDashboard: () => <span>Dashboard</span>,
    PlusCircle: () => <span>PlusCircle</span>,
    LogOut: () => <span>LogOut</span>,
    ChevronDown: () => <span>ChevronDown</span>,
    User: () => <span>User</span>,
    Clock: () => <span>Clock</span>,
    Send: () => <span>Send</span>,
    RefreshCw: () => <span>RefreshCw</span>,
    XOctagon: () => <span>XOctagon</span>,
    AlertCircle: () => <span>AlertCircle</span>,
    Info: () => <span>Info</span>,
    ExternalLink: () => <span>ExternalLink</span>,
    ChevronLeft: () => <span>ChevronLeft</span>,
    ChevronRight: () => <span>ChevronRight</span>,
    Inbox: () => <span data-testid="inbox-icon">Inbox</span>,
    Plus: () => <span>Plus</span>,
    Upload: () => <span>Upload</span>,
    Trash2: () => <span>Trash2</span>,
    FileText: () => <span>FileText</span>,
    Calendar: () => <span>Calendar</span>,
    ShieldAlert: () => <span>ShieldAlert</span>,
    CheckCircle: () => <span>CheckCircle</span>,
    X: () => <span>X</span>,
  };
});

// Mock the AuthContext values
vi.mock('../context/AuthContext', async () => {
  const actual = await vi.importActual<any>('../context/AuthContext');
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

// Mock the EmailService
vi.mock('../services/email.service', () => {
  return {
    emailService: {
      getScheduledEmails: vi.fn(),
      getSentEmails: vi.fn(),
      scheduleEmails: vi.fn(),
      retryEmail: vi.fn(),
      cancelEmail: vi.fn(),
    },
  };
});

describe('ReachInbox Email Scheduler - Frontend Unit Tests', () => {
  const mockUser = {
    id: 'user-123',
    name: 'Pavana',
    email: 'pavana@example.com',
  };

  const mockLoginFn = vi.fn();
  const mockLogoutFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      user: null,
      loading: false,
      login: mockLoginFn,
      logout: mockLogoutFn,
    });
  });

  describe('Login Page', () => {
    it('renders the login page correctly and handles Google login trigger', () => {
      render(
        <ToastProvider>
          <Login />
        </ToastProvider>
      );

      expect(screen.getByText('ReachInbox Email Scheduler')).toBeInTheDocument();
      expect(screen.getByText('Schedule and manage your emails reliably.')).toBeInTheDocument();
      
      const loginBtn = screen.getByRole('button', { name: /continue with google/i });
      expect(loginBtn).toBeInTheDocument();

      fireEvent.click(loginBtn);
      expect(mockLoginFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dashboard Page', () => {
    beforeEach(() => {
      (useAuth as any).mockReturnValue({
        user: mockUser,
        loading: false,
        login: mockLoginFn,
        logout: mockLogoutFn,
      });

      // Default mock responses
      (emailService.getScheduledEmails as any).mockResolvedValue({
        success: true,
        data: {
          data: [
            {
              id: 'email-1',
              recipient: 'receiver@example.com',
              subject: 'Test Subject',
              body: 'Hello body text',
              status: 'SCHEDULED',
              scheduledAt: '2026-08-20T10:00:00.000Z',
              attempts: 0,
              createdAt: '2026-08-19T10:00:00.000Z',
              updatedAt: '2026-08-19T10:00:00.000Z',
            },
          ],
          pagination: { total: 1, pages: 1, page: 1, limit: 10 },
        },
      });

      (emailService.getSentEmails as any).mockResolvedValue({
        success: true,
        data: {
          data: [],
          pagination: { total: 0, pages: 1, page: 1, limit: 10 },
        },
      });
    });

    it('renders scheduled emails list and handles active tab switching', async () => {
      render(
        <ToastProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ToastProvider>
      );

      // Check header info
      expect(screen.getByText('Email Scheduler')).toBeInTheDocument();
      
      // Wait for table to load
      await waitFor(() => {
        expect(screen.getByText('receiver@example.com')).toBeInTheDocument();
      });

      expect(screen.getByText('Test Subject')).toBeInTheDocument();
      expect(screen.getByText('SCHEDULED')).toBeInTheDocument();

      // Click Sent tab
      const sentTabBtn = screen.getByRole('button', { name: /sent & failed emails/i });
      fireEvent.click(sentTabBtn);

      // Check for sent list call
      expect(emailService.getSentEmails).toHaveBeenCalledTimes(1);
    });

    it('renders empty states correctly when list is empty', async () => {
      (emailService.getScheduledEmails as any).mockResolvedValue({
        success: true,
        data: {
          data: [],
          pagination: { total: 0, pages: 1, page: 1, limit: 10 },
        },
      });

      render(
        <ToastProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('No scheduled emails')).toBeInTheDocument();
      });
      expect(screen.getByText("You haven't scheduled any emails yet. Get started by composing a new message.")).toBeInTheDocument();
    });

    it('displays error message when API request fails', async () => {
      const apiError = {
        response: {
          data: {
            message: 'Network Failure',
          },
        },
      };
      (emailService.getScheduledEmails as any).mockRejectedValue(apiError);

      render(
        <ToastProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Network Failure')).toBeInTheDocument();
      });
    });

    it('opens detail modal on row click and allows email cancellation', async () => {
      (emailService.cancelEmail as any).mockResolvedValue({
        success: true,
        message: 'Email cancelled successfully',
      });

      render(
        <ToastProvider>
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        </ToastProvider>
      );

      // Wait for row
      await waitFor(() => {
        expect(screen.getByText('receiver@example.com')).toBeInTheDocument();
      });

      // Click row to open modal
      fireEvent.click(screen.getByText('receiver@example.com'));

      // Check modal contents
      expect(screen.getByText('Email Log Details')).toBeInTheDocument();
      expect(screen.getByText('Hello body text')).toBeInTheDocument();

      // Click cancel button inside modal
      const cancelBtn = screen.getByRole('button', { name: /cancel scheduled email/i });
      fireEvent.click(cancelBtn);

      expect(emailService.cancelEmail).toHaveBeenCalledWith('email-1');
    });
  });

  describe('Compose Email Page & CSV Parser', () => {
    beforeEach(() => {
      (useAuth as any).mockReturnValue({
        user: mockUser,
        loading: false,
        login: mockLoginFn,
        logout: mockLogoutFn,
      });
    });

    it('validates required subject and body inputs', async () => {
      render(
        <ToastProvider>
          <MemoryRouter>
            <Compose />
          </MemoryRouter>
        </ToastProvider>
      );

      const submitBtn = screen.getByRole('button', { name: /schedule campaign/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Subject is required.')).toBeInTheDocument();
        expect(screen.getByText('Email body content is required.')).toBeInTheDocument();
        expect(screen.getByText('Please upload a CSV or TXT file containing recipients.')).toBeInTheDocument();
      });
    });
  });
});
