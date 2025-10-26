// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title PetPortraitNFT
 * @dev NFT contract for TrufflePay premium pet portrait artwork
 * Minted by ModernArtist service alongside portrait delivery
 */
contract PetPortraitNFT is ERC721, ERC721URIStorage {
    uint256 private _nextTokenId;
    address public owner;

    // Mapping from token ID to creation timestamp
    mapping(uint256 => uint256) public tokenTimestamps;

    // Mapping from token ID to artist name
    mapping(uint256 => string) public tokenArtists;

    // Mapping from token ID to style
    mapping(uint256 => string) public tokenStyles;

    event PortraitMinted(
        uint256 indexed tokenId,
        address indexed buyer,
        string artist,
        string style,
        string tokenURI
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    constructor(address initialOwner) ERC721("TrufflePay Pet Portrait", "TPPP") {
        owner = initialOwner;
        _nextTokenId = 1; // Start token IDs at 1
    }

    /**
     * @dev Transfer ownership of the contract
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        owner = newOwner;
    }

    /**
     * @dev Mint a new pet portrait NFT
     * @param buyer Address of the buyer who will receive the NFT
     * @param artist Name of the artist who created the portrait
     * @param style Art style of the portrait
     * @param metadataURI Metadata URI for the NFT (typically IPFS or HTTP URL)
     * @return tokenId The ID of the newly minted NFT
     */
    function mintPortrait(
        address buyer,
        string memory artist,
        string memory style,
        string memory metadataURI
    ) public onlyOwner returns (uint256) {
        require(buyer != address(0), "Cannot mint to zero address");

        uint256 tokenId = _nextTokenId++;

        _safeMint(buyer, tokenId);
        _setTokenURI(tokenId, metadataURI);

        tokenTimestamps[tokenId] = block.timestamp;
        tokenArtists[tokenId] = artist;
        tokenStyles[tokenId] = style;

        emit PortraitMinted(tokenId, buyer, artist, style, metadataURI);

        return tokenId;
    }

    /**
     * @dev Get comprehensive metadata for a token
     * @param tokenId The token ID to query
     * @return artist Name of the artist
     * @return style Art style
     * @return timestamp When the NFT was minted
     * @return uri Token URI
     */
    function getPortraitMetadata(uint256 tokenId)
        public
        view
        returns (
            string memory artist,
            string memory style,
            uint256 timestamp,
            string memory uri
        )
    {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");

        return (
            tokenArtists[tokenId],
            tokenStyles[tokenId],
            tokenTimestamps[tokenId],
            tokenURI(tokenId)
        );
    }

    /**
     * @dev Get the total number of NFTs minted
     */
    function totalSupply() public view returns (uint256) {
        return _nextTokenId - 1;
    }

    // The following functions are overrides required by Solidity
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
