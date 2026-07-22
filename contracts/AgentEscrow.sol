// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentEscrow
 * @dev Experimental escrow contract for AI agent payments on Arc Testnet
 * 
 * SECURITY NOTES:
 * - This contract is EXPERIMENTAL and NOT AUDITED
 * - Use only on testnet with small amounts
 * - Do not use with real funds until professionally audited
 */
contract AgentEscrow is ReentrancyGuard, Ownable {
    enum Status { None, Pending, Released, Disputed, Refunded }

    struct Job {
        address client;
        address worker;
        uint256 amount;
        uint256 disputeDeadline;
        uint256 createdAt;
        Status status;
    }

    IERC20 public immutable usdc;
    address public arbitrator;
    uint256 public disputeWindow = 60 seconds;
    uint256 public constant ARBITRATION_TIMEOUT = 7 days;

    mapping(bytes32 => Job) public jobs;

    event JobCreated(bytes32 indexed jobId, address indexed client, address indexed worker, uint256 amount, uint256 disputeDeadline);
    event JobDisputed(bytes32 indexed jobId, address indexed client);
    event JobReleased(bytes32 indexed jobId, address indexed worker, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event ArbitratorChanged(address indexed oldArbitrator, address indexed newArbitrator);
    event DisputeWindowChanged(uint256 oldWindow, uint256 newWindow);

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "AgentEscrow: not arbitrator");
        _;
    }

    modifier jobExists(bytes32 jobId) {
        require(jobs[jobId].status != Status.None, "AgentEscrow: job does not exist");
        _;
    }

    modifier jobStatus(bytes32 jobId, Status expected) {
        require(jobs[jobId].status == expected, "AgentEscrow: invalid job status");
        _;
    }

    constructor(address usdcToken, address arbitratorAddress) Ownable(msg.sender) {
        require(usdcToken != address(0), "AgentEscrow: invalid USDC address");
        require(arbitratorAddress != address(0), "AgentEscrow: invalid arbitrator address");
        
        usdc = IERC20(usdcToken);
        arbitrator = arbitratorAddress;
    }

    function createJob(bytes32 jobId, address worker, uint256 amount) external nonReentrant {
        require(jobs[jobId].status == Status.None, "AgentEscrow: job already exists");
        require(worker != address(0), "AgentEscrow: invalid worker address");
        require(amount > 0, "AgentEscrow: amount must be > 0");
        
        require(usdc.transferFrom(msg.sender, address(this), amount), "AgentEscrow: USDC transfer failed");

        jobs[jobId] = Job({
            client: msg.sender,
            worker: worker,
            amount: amount,
            disputeDeadline: block.timestamp + disputeWindow,
            createdAt: block.timestamp,
            status: Status.Pending
        });

        emit JobCreated(jobId, msg.sender, worker, amount, block.timestamp + disputeWindow);
    }

    function dispute(bytes32 jobId) external jobExists(jobId) jobStatus(jobId, Status.Pending) {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "AgentEscrow: only client can dispute");
        require(block.timestamp <= job.disputeDeadline, "AgentEscrow: dispute window closed");

        job.status = Status.Disputed;
        emit JobDisputed(jobId, msg.sender);
    }

    function release(bytes32 jobId) external jobExists(jobId) jobStatus(jobId, Status.Pending) nonReentrant {
        Job storage job = jobs[jobId];
        require(block.timestamp > job.disputeDeadline, "AgentEscrow: dispute window still open");

        job.status = Status.Released;
        require(usdc.transfer(job.worker, job.amount), "AgentEscrow: USDC transfer failed");
        emit JobReleased(jobId, job.worker, job.amount);
    }

    function resolve(bytes32 jobId, bool releaseToWorker) external onlyArbitrator jobExists(jobId) jobStatus(jobId, Status.Disputed) nonReentrant {
        Job storage job = jobs[jobId];

        if (releaseToWorker) {
            job.status = Status.Released;
            require(usdc.transfer(job.worker, job.amount), "AgentEscrow: USDC transfer failed");
            emit JobReleased(jobId, job.worker, job.amount);
        } else {
            job.status = Status.Refunded;
            require(usdc.transfer(job.client, job.amount), "AgentEscrow: USDC transfer failed");
            emit JobRefunded(jobId, job.client, job.amount);
        }
    }

    function forceRefund(bytes32 jobId) external jobExists(jobId) jobStatus(jobId, Status.Disputed) nonReentrant {
        Job storage job = jobs[jobId];
        require(block.timestamp > job.disputeDeadline + ARBITRATION_TIMEOUT, "AgentEscrow: arbitration still active");

        job.status = Status.Refunded;
        require(usdc.transfer(job.client, job.amount), "AgentEscrow: USDC transfer failed");
        emit JobRefunded(jobId, job.client, job.amount);
    }

    function setArbitrator(address newArbitrator) external onlyOwner {
        require(newArbitrator != address(0), "AgentEscrow: invalid arbitrator address");
        emit ArbitratorChanged(arbitrator, newArbitrator);
        arbitrator = newArbitrator;
    }

    function setDisputeWindow(uint256 newWindow) external onlyOwner {
        require(newWindow > 0, "AgentEscrow: window must be > 0");
        require(newWindow <= 7 days, "AgentEscrow: window too long");
        emit DisputeWindowChanged(disputeWindow, newWindow);
        disputeWindow = newWindow;
    }

    function getJob(bytes32 jobId) external view jobExists(jobId) returns (Job memory) {
        return jobs[jobId];
    }

    function isDisputable(bytes32 jobId) external view jobExists(jobId) returns (bool) {
        Job memory job = jobs[jobId];
        return job.status == Status.Pending && block.timestamp <= job.disputeDeadline;
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
