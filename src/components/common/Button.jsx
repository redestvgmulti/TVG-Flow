import React from 'react';
import './Button.css';

export const Button = ({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    disabled = false,
    loading = false,
    onClick,
    type = 'button',
    className = '',
    ...props
}) => {
    const baseClass = 'btn';
    const variantClass = `btn-${variant}`;
    const sizeClass = `btn-${size}`;
    const fullWidthClass = fullWidth ? 'btn-full' : '';
    const classes = `${baseClass} ${variantClass} ${sizeClass} ${fullWidthClass} ${className}`.trim();

    return (
        <button
            type={type}
            className={classes}
            disabled={disabled || loading}
            onClick={onClick}
            {...props}
        >
            {loading ? (
                <span className="btn-loading">
                    <span className="spin"></span>
                </span>
            ) : (
                children
            )}
        </button>
    );
};
