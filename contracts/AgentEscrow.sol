// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// EXPERIMENTAL — not audited. Built as a learning exercise to move escrow
// logic on-chain, mirroring AgentGuard's off-chain escrowJob.js flow:
// escrow -> dispute window -> auto-release OR human arbitration.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract AgentEscrow {
    enum Status { None, Pending, Released, Disputed, Refunded }

    struct Job {
        address client;
        address worker;
        uint256 amount;
        uint256 disputeDeadline;
        Status status;
    }

    IERC20 public immutable usdc;
    address public arbitrator;
    uint256 public disputeWindow = 8 seconds;

    mapping(bytes32 => Job) public jobs;

    event JobCreated(bytes32 indexed jobId, address indexed client, address indexed worker, uint256 amount, uint256 disputeDeadline);
    event JobDisputed(bytes32 indexed jobId);
    event JobReleased(bytes32 indexed jobId, address to);
    event JobRefunded(bytes32 indexed jobId, address to);

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "not arbitrator");
        _;
    }

    constructor(address usdcToken, address arbitratorAddress) {
        usdc = IERC20(usdcToken);
        arbitrator = arbitratorAddress;
    }

    function createJob(bytes32 jobId, address worker, uint256 amount) external {
        require(jobs[jobId].status == Status.None, "job exists");
        require(usdc.transferFrom(msg.sender, address(this), amount), "transfer failed");

        jobs[jobId] = Job({
            client: msg.sender,
            worker: worker,
            amount: amount,
            disputeDeadline: block.timestamp + disputeWindow,
            status: Status.Pending
        });

        emit JobCreated(jobId, msg.sender, worker, amount, block.timestamp + disputeWindow);
    }

    function dispute(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        require(job.status == Status.Pending, "not disputable");
        require(msg.sender == job.client, "not client");
        require(block.timestamp <= job.disputeDeadline, "window closed");

        job.status = Status.Disputed;
        emit JobDisputed(jobId);
    }

    function release(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        require(job.status == Status.Pending, "not releasable");
        require(block.timestamp > job.disputeDeadline, "window still open");

        job.status = Status.Released;
        require(usdc.transfer(job.worker, job.amount), "transfer failed");
        emit JobReleased(jobId, job.worker);
    }

    function resolve(bytes32 jobId, bool releaseToWorker) external onlyArbitrator {
        Job storage job = jobs[jobId];
        require(job.status == Status.Disputed, "not disputed");

        if (releaseToWorker) {
            job.status = Status.Released;
            require(usdc.transfer(job.worker, job.amount), "transfer failed");
            emit JobReleased(jobId, job.worker);
        } else {
            job.status = Status.Refunded;
            require(usdc.transfer(job.client, job.amount), "transfer failed");
            emit JobRefunded(jobId, job.client);
        }
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
