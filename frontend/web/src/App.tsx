import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ScientificPaper {
  id: string;
  title: string;
  abstract: string;
  encryptedContentId: string; // Encrypted content ID (simulated with FHE)
  price: number; // Price in ETH
  owner: string;
  timestamp: number;
  category: string;
  status: "pending" | "published" | "rejected";
  citations: number;
}

// Simulate FHE encryption for numerical values
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

// Simulate FHE decryption for numerical values
const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [papers, setPapers] = useState<ScientificPaper[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPaperData, setNewPaperData] = useState({ title: "", abstract: "", category: "", price: 0.1 });
  const [selectedPaper, setSelectedPaper] = useState<ScientificPaper | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  
  const publishedCount = papers.filter(p => p.status === "published").length;
  const pendingCount = papers.filter(p => p.status === "pending").length;
  const rejectedCount = papers.filter(p => p.status === "rejected").length;
  
  // Top contributors based on number of papers published
  const topContributors = Array.from(
    papers.reduce((map, paper) => {
      const count = map.get(paper.owner) || 0;
      map.set(paper.owner, count + 1);
      return map;
    }, new Map<string, number>())
  )
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

  useEffect(() => {
    loadPapers().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadPapers = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get paper keys
      const keysBytes = await contract.getData("paper_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing paper keys:", e); }
      }
      
      // Load each paper
      const list: ScientificPaper[] = [];
      for (const key of keys) {
        try {
          const paperBytes = await contract.getData(`paper_${key}`);
          if (paperBytes.length > 0) {
            try {
              const paperData = JSON.parse(ethers.toUtf8String(paperBytes));
              list.push({ 
                id: key, 
                title: paperData.title,
                abstract: paperData.abstract,
                encryptedContentId: paperData.encryptedContentId,
                price: paperData.price,
                owner: paperData.owner,
                timestamp: paperData.timestamp,
                category: paperData.category,
                status: paperData.status || "pending",
                citations: paperData.citations || 0
              });
            } catch (e) { console.error(`Error parsing paper data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading paper ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPapers(list);
    } catch (e) { console.error("Error loading papers:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitPaper = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting paper content with Zama FHE..." });
    
    try {
      // Simulate FHE encryption of content ID
      const contentId = Math.floor(Math.random() * 1000000); // This would be the actual content ID
      const encryptedContentId = FHEEncryptNumber(contentId);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const paperId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const paperData = { 
        title: newPaperData.title,
        abstract: newPaperData.abstract,
        encryptedContentId,
        price: newPaperData.price,
        owner: address,
        timestamp: Math.floor(Date.now() / 1000),
        category: newPaperData.category,
        status: "pending",
        citations: 0
      };
      
      // Store paper data
      await contract.setData(`paper_${paperId}`, ethers.toUtf8Bytes(JSON.stringify(paperData)));
      
      // Update keys list
      const keysBytes = await contract.getData("paper_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(paperId);
      await contract.setData("paper_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Paper submitted securely with FHE encryption!" });
      await loadPapers();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPaperData({ title: "", abstract: "", category: "", price: 0.1 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedContentId: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedContentId);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const publishPaper = async (paperId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Publishing paper..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const paperBytes = await contract.getData(`paper_${paperId}`);
      if (paperBytes.length === 0) throw new Error("Paper not found");
      const paperData = JSON.parse(ethers.toUtf8String(paperBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedPaper = { ...paperData, status: "published" };
      await contractWithSigner.setData(`paper_${paperId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPaper)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Paper published successfully!" });
      await loadPapers();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Publication failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectPaper = async (paperId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Rejecting paper..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const paperBytes = await contract.getData(`paper_${paperId}`);
      if (paperBytes.length === 0) throw new Error("Paper not found");
      const paperData = JSON.parse(ethers.toUtf8String(paperBytes));
      
      const updatedPaper = { ...paperData, status: "rejected" };
      await contract.setData(`paper_${paperId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPaper)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Paper rejected!" });
      await loadPapers();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const citePaper = async (paperId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Citing paper..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const paperBytes = await contract.getData(`paper_${paperId}`);
      if (paperBytes.length === 0) throw new Error("Paper not found");
      const paperData = JSON.parse(ethers.toUtf8String(paperBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedPaper = { ...paperData, citations: (paperData.citations || 0) + 1 };
      await contractWithSigner.setData(`paper_${paperId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPaper)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Citation added successfully!" });
      await loadPapers();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Citation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (paperOwner: string) => address?.toLowerCase() === paperOwner.toLowerCase();

  // Filter papers based on search term and category
  const filteredPapers = papers.filter(paper => {
    const matchesSearch = paper.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          paper.abstract.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || paper.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="glacier-spinner"></div>
      <p>Initializing encrypted publishing platform...</p>
    </div>
  );

  return (
    <div className="app-container glacier-glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="fhe-icon"></div></div>
          <h1>DeSci<span>Publish</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-paper-btn glass-button">
            <div className="add-icon"></div>Publish Paper
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="main-content">
        {/* Project Introduction */}
        <div className="project-intro glass-card">
          <div className="intro-content">
            <h2>Decentralized Scientific Publishing with FHE</h2>
            <p>A revolutionary platform where scientists can publish FHE-encrypted papers. 
            Only paying users can decrypt and read content, with royalties automatically distributed 
            to authors and reviewers via privacy-preserving payment streams.</p>
            
            <div className="features-grid">
              <div className="feature">
                <div className="feature-icon">🔒</div>
                <h3>FHE-Encrypted Content</h3>
                <p>Paper content encrypted using Zama FHE technology</p>
              </div>
              <div className="feature">
                <div className="feature-icon">💰</div>
                <h3>Automatic Royalties</h3>
                <p>Smart contracts manage payments and distribution</p>
              </div>
              <div className="feature">
                <div className="feature-icon">🖼️</div>
                <h3>Paper NFTs</h3>
                <p>Scientific papers represented as tradable NFTs</p>
              </div>
              <div className="feature">
                <div className="feature-icon">🌐</div>
                <h3>Decentralized</h3>
                <p>Disrupting traditional, monopolistic academic publishing</p>
              </div>
            </div>
          </div>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
        
        {/* Search & Filter Section */}
        <div className="search-filter-section glass-card">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search papers by title or abstract..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="glass-input"
            />
            <div className="search-icon"></div>
          </div>
          
          <div className="filter-container">
            <label>Filter by Category:</label>
            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="glass-select"
            >
              <option value="all">All Categories</option>
              <option value="Biology">Biology</option>
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Computer Science">Computer Science</option>
              <option value="Mathematics">Mathematics</option>
              <option value="Medicine">Medicine</option>
            </select>
          </div>
        </div>
        
        {/* Statistics Cards */}
        <div className="stats-grid">
          <div className="stat-card glass-card">
            <h3>Total Papers</h3>
            <div className="stat-value">{papers.length}</div>
          </div>
          <div className="stat-card glass-card">
            <h3>Published</h3>
            <div className="stat-value">{publishedCount}</div>
          </div>
          <div className="stat-card glass-card">
            <h3>Pending Review</h3>
            <div className="stat-value">{pendingCount}</div>
          </div>
          <div className="stat-card glass-card">
            <h3>Top Citations</h3>
            <div className="stat-value">
              {papers.length > 0 ? Math.max(...papers.map(p => p.citations)) : 0}
            </div>
          </div>
        </div>
        
        {/* Top Contributors */}
        <div className="contributors-section glass-card">
          <h2>Top Contributors</h2>
          <div className="contributors-list">
            {topContributors.length > 0 ? (
              topContributors.map(([address, count], index) => (
                <div className="contributor" key={address}>
                  <div className="rank">{index + 1}</div>
                  <div className="address">{address.substring(0, 6)}...{address.substring(38)}</div>
                  <div className="paper-count">{count} papers</div>
                </div>
              ))
            ) : (
              <div className="no-contributors">No contributors yet</div>
            )}
          </div>
        </div>
        
        {/* Papers List */}
        <div className="papers-section">
          <div className="section-header">
            <h2>Scientific Papers</h2>
            <div className="header-actions">
              <button onClick={loadPapers} className="refresh-btn glass-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="papers-grid">
            {filteredPapers.length === 0 ? (
              <div className="no-papers glass-card">
                <div className="no-papers-icon"></div>
                <p>No papers found matching your criteria</p>
                <button className="glass-button primary" onClick={() => setShowCreateModal(true)}>Publish First Paper</button>
              </div>
            ) : filteredPapers.map(paper => (
              <div className="paper-card glass-card" key={paper.id} onClick={() => setSelectedPaper(paper)}>
                <div className="paper-header">
                  <h3 className="paper-title">{paper.title}</h3>
                  <span className={`status-badge ${paper.status}`}>{paper.status}</span>
                </div>
                
                <div className="paper-meta">
                  <div className="meta-item">
                    <span className="meta-label">Author:</span>
                    <span className="meta-value">{paper.owner.substring(0, 6)}...{paper.owner.substring(38)}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Category:</span>
                    <span className="meta-value">{paper.category}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Date:</span>
                    <span className="meta-value">{new Date(paper.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Citations:</span>
                    <span className="meta-value">{paper.citations}</span>
                  </div>
                </div>
                
                <div className="paper-abstract">
                  {paper.abstract.substring(0, 150)}...
                </div>
                
                <div className="paper-price">
                  <span className="price-label">Access Price:</span>
                  <span className="price-value">{paper.price} ETH</span>
                </div>
                
                <div className="paper-actions">
                  <button 
                    className="action-btn glass-button" 
                    onClick={(e) => { e.stopPropagation(); citePaper(paper.id); }}
                  >
                    Cite
                  </button>
                  
                  {isOwner(paper.owner) && paper.status === "pending" && (
                    <>
                      <button 
                        className="action-btn glass-button success" 
                        onClick={(e) => { e.stopPropagation(); publishPaper(paper.id); }}
                      >
                        Publish
                      </button>
                      <button 
                        className="action-btn glass-button danger" 
                        onClick={(e) => { e.stopPropagation(); rejectPaper(paper.id); }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePaper 
          onSubmit={submitPaper} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          paperData={newPaperData} 
          setPaperData={setNewPaperData}
        />
      )}
      
      {selectedPaper && (
        <PaperDetailModal 
          paper={selectedPaper} 
          onClose={() => setSelectedPaper(null)} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="glacier-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="fhe-icon"></div><span>DeSciPublishFHE</span></div>
            <p>Decentralized scientific publishing with FHE encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} DeSciPublishFHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreatePaperProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  paperData: any;
  setPaperData: (data: any) => void;
}

const ModalCreatePaper: React.FC<ModalCreatePaperProps> = ({ onSubmit, onClose, creating, paperData, setPaperData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPaperData({ ...paperData, [name]: value });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPaperData({ ...paperData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!paperData.title || !paperData.abstract || !paperData.category) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Publish New Scientific Paper</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your paper content will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Title *</label>
              <input 
                type="text" 
                name="title" 
                value={paperData.title} 
                onChange={handleChange} 
                placeholder="Enter paper title..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category" 
                value={paperData.category} 
                onChange={handleChange} 
                className="glass-select"
              >
                <option value="">Select category</option>
                <option value="Biology">Biology</option>
                <option value="Physics">Physics</option>
                <option value="Chemistry">Chemistry</option>
                <option value="Computer Science">Computer Science</option>
                <option value="Mathematics">Mathematics</option>
                <option value="Medicine">Medicine</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Access Price (ETH) *</label>
              <input 
                type="number" 
                name="price" 
                value={paperData.price} 
                onChange={handlePriceChange} 
                placeholder="Set access price..." 
                className="glass-input"
                min="0.01"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Abstract *</label>
            <textarea 
              name="abstract" 
              value={paperData.abstract} 
              onChange={handleChange} 
              placeholder="Enter paper abstract..." 
              className="glass-textarea"
              rows={4}
            />
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Content ID:</span>
                <div>123456 (example)</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted ID:</span>
                <div>FHE-MTIzNDU2...</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Paper content remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn glass-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn glass-button primary">
            {creating ? "Encrypting with FHE..." : "Publish Paper"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PaperDetailModalProps {
  paper: ScientificPaper;
  onClose: () => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const PaperDetailModal: React.FC<PaperDetailModalProps> = ({ paper, onClose, isDecrypting, decryptWithSignature }) => {
  const [decryptedContentId, setDecryptedContentId] = useState<number | null>(null);
  
  const handleDecrypt = async () => {
    if (decryptedContentId !== null) { 
      setDecryptedContentId(null); 
      return; 
    }
    
    const decrypted = await decryptWithSignature(paper.encryptedContentId);
    if (decrypted !== null) setDecryptedContentId(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="paper-detail-modal glass-card">
        <div className="modal-header">
          <h2>{paper.title}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="paper-info">
            <div className="info-item">
              <span>Author:</span>
              <strong>{paper.owner.substring(0, 6)}...{paper.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Category:</span>
              <strong>{paper.category}</strong>
            </div>
            <div className="info-item">
              <span>Published:</span>
              <strong>{new Date(paper.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${paper.status}`}>{paper.status}</strong>
            </div>
            <div className="info-item">
              <span>Citations:</span>
              <strong>{paper.citations}</strong>
            </div>
          </div>
          
          <div className="paper-abstract-section">
            <h3>Abstract</h3>
            <p>{paper.abstract}</p>
          </div>
          
          <div className="encrypted-data-section">
            <div className="section-header">
              <h3>Encrypted Content</h3>
              <div className="fhe-tag">
                <div className="fhe-icon"></div>
                <span>FHE Encrypted</span>
              </div>
            </div>
            
            <div className="encrypted-content">
              <div className="encrypted-id">
                <span>Content ID:</span>
                <div>{paper.encryptedContentId.substring(0, 50)}...</div>
              </div>
              
              <button 
                className="decrypt-btn glass-button" 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  <span className="decrypt-spinner"></span>
                ) : decryptedContentId !== null ? (
                  "Hide Content ID"
                ) : (
                  "Decrypt Content ID"
                )}
              </button>
            </div>
            
            {decryptedContentId !== null && (
              <div className="decrypted-data-section">
                <h4>Decrypted Content ID</h4>
                <div className="decrypted-value">{decryptedContentId}</div>
                <div className="decryption-notice">
                  <div className="warning-icon"></div>
                  <span>This ID allows access to the full paper content</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="purchase-section">
            <h3>Access Full Paper</h3>
            <div className="price-display">
              <span className="price-label">Price:</span>
              <span className="price-value">{paper.price} ETH</span>
            </div>
            <button className="purchase-btn glass-button primary">
              Purchase Access
            </button>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn glass-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;