import subprocess
import json
import sys
import os

# Top 10 highest priority backend issues for Delego
ISSUES = [
    {
        "title": "[Gateway] Implement JWT Authentication and User Registration",
        "body": """### Description
Implement the authentication system for the Delego platform API gateway. This includes user registration, password hashing (bcrypt), JWT token issuance, and authentication middleware for route protection.

### Acceptance Criteria
- Users can register with email and password.
- Passwords are securely hashed using bcrypt.
- JWT is generated upon successful login.
- Middleware checks for valid JWT in Authorization header.
- Unit tests verifying auth flow and middleware.

### Scope
- `services/gateway`"""
    },
    {
        "title": "[Gateway] Implement Spending Limits and Permissions Database Models",
        "body": """### Description
Design and implement the PostgreSQL database schemas and Sequelize/TypeORM models for user spend limits, delegation policies, and permission levels.

### Acceptance Criteria
- Schemas include limits per transaction, daily, weekly, and lifetime.
- Support for restricting specific merchants or categories.
- Models linked to users and delegation wallets.
- Migrations and seed scripts implemented.

### Scope
- `services/gateway`"""
    },
    {
        "title": "[Wallet] Implement Key Management and Stellar Account Creation",
        "body": """### Description
Build the backend wallet service responsible for securely generating and managing Stellar account keys for users and delegation agents.

### Acceptance Criteria
- Secure generation of Stellar keypairs.
- Integration with Stellar Testnet/Mainnet SDK.
- Vault/Secrets manager configuration for storing master/signing keys.
- API endpoints to generate user wallets and delegate key sets.

### Scope
- `services/wallet`"""
    },
    {
        "title": "[Wallet] Build Soroban Transaction Simulator and Fee Estimator",
        "body": """### Description
Develop a transaction simulation engine to verify Soroban smart contract calls before submission. This will validate spending limits and estimate transaction fees.

### Acceptance Criteria
- Simulates smart contract calls via Soroban RPC client.
- Extracts fee estimates and resource consumption.
- Detects potential failure reasons (e.g., exceeded spend limits) prior to on-chain submission.

### Scope
- `services/wallet`"""
    },
    {
        "title": "[Wallet] Develop Secure Transaction Signing and Submission Queue",
        "body": """### Description
Implement a resilient queue system for signing and submitting Stellar transactions, handling sequence numbers, network congestion, and retries.

### Acceptance Criteria
- Thread-safe sequence number management.
- Retries transactions on transient Horizon errors (e.g., timeout).
- Relies on Redis-based queue (BullMQ or similar) to ensure ordered execution.

### Scope
- `services/wallet`"""
    },
    {
        "title": "[Payments] Implement Soroban Escrow Contract Interaction Suite",
        "body": """### Description
Build the backend services/payments integration with the Soroban Escrow smart contracts, exposing APIs to initialize, deposit, release, and refund escrows.

### Acceptance Criteria
- Functions to call initialize, deposit, release, and refund on-chain.
- Standardized request/response validation.
- Logging of contract transaction hashes.

### Scope
- `services/payments`"""
    },
    {
        "title": "[Orchestrator] Implement Core XState Purchase Workflow Machine",
        "body": """### Description
Build the central state machine using XState to coordinate delegated purchase workflows.

### Acceptance Criteria
- States: Discovery, SpendingCheck, UserApprovalPending, EscrowLocking, MerchantFulfillment, DeliveryVerification, Completed, Refunded.
- Persistent state transitions logged to database.
- Resiliency logic to recover running workflows on crash.

### Scope
- `services/orchestrator`"""
    },
    {
        "title": "[Agents] Design AI Agent Tool Execution Registry",
        "body": """### Description
Implement a secure registry of tools that the LLM agent can execute (e.g., search product, check spend limits, request escrow deposit).

### Acceptance Criteria
- Strict schema validation for tool inputs.
- Execution sandboxing to prevent arbitrary code execution.
- Detailed execution log saved for auditing.

### Scope
- `services/agents`"""
    },
    {
        "title": "[Agents] Integrate OpenAI and Anthropic API Client Runtimes",
        "body": """### Description
Implement LLM client runtimes supporting OpenAI and Anthropic APIs, handling system prompts, chat history, and fallback strategies.

### Acceptance Criteria
- Support for GPT-4 and Claude 3.5 Sonnet.
- Rate limit handling and retry logic.
- Token tracking and budget enforcement per request.

### Scope
- `services/agents`"""
    },
    {
        "title": "[Notifications] Build Multi-Channel Notification Dispatcher (Email & Web Push)",
        "body": """### Description
Implement a multi-channel alerting service using SendGrid for email and the Web Push API for browser notifications, primarily for transaction approval workflows.

### Acceptance Criteria
- Template-based email dispatching via SendGrid.
- Web Push notification subscriptions and delivery.
- Actionable push payloads containing transaction details.

### Scope
- `services/notifications`"""
    }
]

def find_gh_binary():
    # Check if gh is available in PATH
    try:
        subprocess.run(["gh", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return "gh"
    except FileNotFoundError:
        pass

    # Check local downloaded path
    local_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../scratch_gh/gh_2.94.0_linux_amd64/bin/gh"))
    if os.path.exists(local_path):
        return local_path
    
    return None

def check_auth(gh_bin):
    # If GITHUB_TOKEN is in environment, gh will use it
    if "GITHUB_TOKEN" in os.environ or "GH_TOKEN" in os.environ:
        return True
    
    # Otherwise check gh auth status
    try:
        res = subprocess.run([gh_bin, "auth", "status"], capture_output=True, text=True)
        if res.returncode == 0:
            return True
    except Exception:
        pass
    return False

def ensure_labels(gh_bin):
    labels = [
        {"name": "backend", "color": "5319e7", "description": "Backend services and APIs"},
        {"name": "high-priority", "color": "d93f0b", "description": "Highest priority tasks"}
    ]
    
    print("Ensuring repository labels exist...")
    for label in labels:
        cmd = [
            gh_bin, "label", "create", label["name"],
            "--color", label["color"],
            "--description", label["description"],
            "--force"
        ]
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            print(f"  Label '{label['name']}' is ready.")
        except subprocess.CalledProcessError as e:
            print(f"  Warning: Failed to ensure label '{label['name']}' exists: {e}", file=sys.stderr)

def main():
    gh_bin = find_gh_binary()
    if not gh_bin:
        print("Error: GitHub CLI (gh) not found in PATH or in scratch_gh.", file=sys.stderr)
        print("Please ensure gh is installed or run scripts from the workspace root.", file=sys.stderr)
        sys.exit(1)

    print(f"Using GitHub CLI binary: {gh_bin}")

    if not check_auth(gh_bin):
        print("\n" + "="*80, file=sys.stderr)
        print("ERROR: GitHub CLI is not authenticated.", file=sys.stderr)
        print("Please set your GitHub Token in the environment or login first:", file=sys.stderr)
        print("  Option 1: export GITHUB_TOKEN=your_token_here", file=sys.stderr)
        print("  Option 2: Run 'gh auth login' inside your terminal", file=sys.stderr)
        print("="*80 + "\n", file=sys.stderr)
        sys.exit(1)

    print("Authentication verified.")
    ensure_labels(gh_bin)
    
    print("Creating issues...")
    for idx, issue in enumerate(ISSUES, 1):
        print(f"[{idx}/10] Creating issue: {issue['title']}...")
        cmd = [
            gh_bin, "issue", "create",
            "--title", issue["title"],
            "--body", issue["body"],
            "--label", "backend,high-priority"
        ]
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            print(f"  Success! Issue URL: {res.stdout.strip()}")
        except subprocess.CalledProcessError as e:
            print(f"  Failed to create issue. Error:\n{e.stderr}", file=sys.stderr)
            sys.exit(1)

    print("\nAll 10 priority issues have been created successfully!")

if __name__ == "__main__":
    main()
