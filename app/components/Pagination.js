// components/Pagination.jsx
"use client";

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}) {
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, 5, "...", totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(
          1,
          "...",
          totalPages - 4,
          totalPages - 3,
          totalPages - 2,
          totalPages - 1,
          totalPages
        );
      } else {
        pages.push(
          1,
          "...",
          currentPage - 1,
          currentPage,
          currentPage + 1,
          "...",
          totalPages
        );
      }
    }

    return pages;
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="flex flex-col lg:flex-row items-center justify-between gap-4 w-full px-4 md:px-8 py-4">
      {/* Left side - Page info */}
      <div className="order-1 lg:order-1">
        <span className="text-[#C8C8C8] text-[16px] md:text-[20px] font-medium">
          Page {currentPage} of {totalPages}
        </span>
      </div>

      {/* Center - Pagination Controls */}
      <div className="flex items-center flex-wrap justify-center gap-2 md:gap-5 order-3 lg:order-2">
        <div className="flex items-center gap-1">
          {/* First Page Button */}
          <button
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
            className={`btn-anim w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              currentPage === 1
                ? "text-[#666666] cursor-not-allowed"
                : "text-[#FFFFFF] cursor-pointer hover:bg-[#2A2A2A]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M11 12L7 8L11 4M5 12L1 8L5 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Previous Button */}
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className={`btn-anim w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              currentPage === 1
                ? "text-[#666666] cursor-not-allowed"
                : "text-[#FFFFFF] cursor-pointer hover:bg-[#2A2A2A]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8L10 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Page Numbers */}
        <div className="flex items-center gap-2">
          {getPageNumbers().map((page, index) => (
            <button
              key={index}
              onClick={() => typeof page === "number" && handlePageChange(page)}
              disabled={page === "..."}
              className={`btn-anim min-w-[40px] h-10 rounded-[8px] border font-medium text-sm transition-colors ${
                page === currentPage
                  ? "nav-active border-[#FFFFFF47] text-[#FFFFFF]"
                  : page === "..."
                  ? "bg-transparent text-[#666666] border-[#FFFFFF1A] cursor-default"
                  : "bg-[#FFFFFF17] text-[#FFFFFF] border-[#FFFFFF1A] hover:bg-[#2A2A2A]"
              }`}
            >
              {page}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {/* Next Button */}
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className={`btn-anim w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              currentPage === totalPages
                ? "text-[#666666] cursor-not-allowed"
                : "text-white cursor-pointer hover:bg-[#2A2A2A]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 12L10 8L6 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Last Page Button */}
          <button
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
            className={`btn-anim w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              currentPage === totalPages
                ? "text-[#666666] cursor-not-allowed"
                : "text-white cursor-pointer hover:bg-[#2A2A2A]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M5 12L9 8L5 4M11 12L15 8L11 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Right side - Go to page */}
      <div className="flex items-center gap-2 order-2 lg:order-3">
        <span className="text-[#C8C8C8] text-[12px] font-medium whitespace-nowrap">
          Go to page
        </span>
        <input
          type="number"
          min="1"
          max={totalPages}
          placeholder={currentPage}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const page = parseInt(e.target.value);
              if (page >= 1 && page <= totalPages) {
                handlePageChange(page);
                e.target.value = "";
              }
            }
          }}
          onBlur={(e) => {
            const page = parseInt(e.target.value);
            if (page >= 1 && page <= totalPages) {
              handlePageChange(page);
              e.target.value = "";
            }
          }}
          className="w-16 px-3 py-2 bg-[#1A1A1A] text-[#FFFFFF] rounded-lg border border-[#333333] focus:outline-none focus:border-[#2BD383] text-sm"
        />
      </div>
    </div>
  );
}