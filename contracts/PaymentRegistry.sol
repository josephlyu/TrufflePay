// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract PaymentRegistry is ReentrancyGuard {
    struct Invoice { address seller; address token; uint256 amount; bool paid; }
    mapping(bytes32 => Invoice) public invoices;

    event InvoiceCreated(bytes32 indexed invoiceId, address indexed seller, address token, uint256 amount);
    event InvoicePaid(bytes32 indexed invoiceId, address indexed buyer, address indexed seller, address token, uint256 amount);

    // create invoice (seller calls)
    function createInvoice(bytes32 invoiceId, address token, uint256 amount) external {
        require(invoices[invoiceId].seller == address(0), "invoice exists");
        invoices[invoiceId] = Invoice({ seller: msg.sender, token: token, amount: amount, paid: false });
        emit InvoiceCreated(invoiceId, msg.sender, token, amount);
    }

    // pay an invoice: token must be ERC20 and approved by buyer to this contract
    function payInvoice(bytes32 invoiceId) external nonReentrant {
        Invoice storage inv = invoices[invoiceId];
        require(inv.seller != address(0), "invoice not found");
        require(!inv.paid, "already paid");
        require(IERC20(inv.token).transferFrom(msg.sender, address(this), inv.amount), "transfer failed");
        inv.paid = true;
        emit InvoicePaid(invoiceId, msg.sender, inv.seller, inv.token, inv.amount);
    }

    // seller withdraws funds for a given invoice
    function withdraw(bytes32 invoiceId) external nonReentrant {
        Invoice storage inv = invoices[invoiceId];
        require(inv.seller == msg.sender, "only seller");
        require(inv.paid, "not paid");
        uint256 amount = inv.amount;
        inv.amount = 0;
        require(IERC20(inv.token).transfer(msg.sender, amount), "transfer failed");
    }
}
