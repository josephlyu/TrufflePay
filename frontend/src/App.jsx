import React, {useState} from 'react';
import { ethers } from 'ethers';

export default function App(){
  const [resource, setResource] = useState('example-1');
  const [invoice, setInvoice] = useState(null);

  async function requestResource(){
    const res = await fetch(`${process.env.REACT_APP_SELLER_URL || 'http://localhost:3030'}/resource/${resource}`);
    if (res.status === 402) {
      const inv = await res.json();
      setInvoice(inv);
      return;
    }
    const js = await res.json();
    alert('Resource delivered: ' + JSON.stringify(js));
  }

  async function payWithMetamask(){
    if (!invoice) return alert('no invoice');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const erc20 = new ethers.Contract(invoice.token, ["function approve(address spender,uint256 amount) public returns(bool)"], signer);
    const approve = await erc20.approve(invoice.paymentRegistry, invoice.amount);
    await approve.wait();
    const registry = new ethers.Contract(invoice.paymentRegistry, ["function payInvoice(bytes32 invoiceId) public"], signer);
    const tx = await registry.payInvoice(ethers.utils.id(invoice.invoiceId));
    await tx.wait();
    alert('Paid! Refresh resource.');
  }

  return (
    <div style={{padding:20}}>
      <h2>AI-to-AI Payment PoC</h2>
      <div>
        <input value={resource} onChange={e=>setResource(e.target.value)} />
        <button onClick={requestResource}>Request Resource</button>
      </div>
      {invoice && (
        <div style={{marginTop:20}}>
          <h3>Invoice</h3>
          <pre>{JSON.stringify(invoice,null,2)}</pre>
          <button onClick={payWithMetamask}>Pay with MetaMask</button>
        </div>
      )}
    </div>
  )
}
